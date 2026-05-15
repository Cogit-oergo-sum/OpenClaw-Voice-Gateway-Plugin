import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { FastAgentResponse } from './types';
import { TextCleaner } from '../utils/text-cleaner';
import { ResultSummarizer } from './result-summarizer';
import { ToolResultHandler } from './tool-result-handler';
import { SLE_ACTION_PROTOCOL, SLE_ASR_CORRECTION_PROTOCOL } from './prompts';
import { SkillRegistry } from './skills';
import { PromptAssembler } from './prompt-assembler';
import { LlmLogger } from '../utils/llm-logger';

/**
 * [V3.3.0] SLEEngine: 逻辑魂魄引擎 (已瘦身)
 * 职责：专家级分析、决定工具调用意图。
 * 执行与结果解析已被抽离至 ToolResultHandler。
 */
export class SLEEngine {
    private openai: OpenAI;

    constructor(
        private config: PluginConfig,
        private resultSummarizer: ResultSummarizer,
        private toolResultHandler: ToolResultHandler
    ) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
    }

    async run(
        messages: any[],
        text: string,
        current_intent: string,
        promptAssembler: PromptAssembler,
        callId: string,
        canvasSnapshot: string,
        canvasManager: CanvasManager,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        source: string = 'User-Input',
        scenario: import('./types').SLEScenario = 'DECIDING',
        taskId?: string,
        tracker?: any  // [V3.7.2] 耗时追踪
    ): Promise<{ output: string; toolCalls: any[]; intent: string; parsed?: any }> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
        let sleFullOutput = "";
        let toolCalls: any[] = [];
        let sleIntent = "";
        let parsed: any = null;

        try {
            let taskOutput = (taskId ? (canvas.tasks.find(t => t.id === taskId) || canvas.task_status) : canvas.task_status)?.summary;
            if (scenario === 'DECIDING' && !taskOutput && current_intent) {
                taskOutput = `[Intent] ${current_intent}`;
            }

            const sleMessages = await promptAssembler.assembleSLEPayload(scenario, callId, {
                text,
                current_intent,
                canvasSnapshot,
                dialogueHistory: messages.slice(0, -1),
                taskOutput,
                taskIntent: current_intent
            });


            const availableTools = SkillRegistry.getInstance().getAllSchemas();

            const isInternal = text === '__INTERNAL_TRIGGER__';
            const hasTools = availableTools.length > 0 && !isInternal;
            const payload: any = {
                model: sleModel,
                messages: sleMessages,
                stream: false,
                parallel_tool_calls: true,
            };

            // [V4.5] response_format: json_object 与 tools + tool_choice 冲突（qwen 模型 400 报错）
            // 有 tools 时由模型自行决定输出格式；无 tools 时强制 JSON 以便解析 intent
            if (!hasTools) {
                payload.response_format = { type: 'json_object' };
            }

            // [V3.6.17] 核心保护：如果是内部触发指令 (Reporting)，严禁提供工具描述，强制模型仅进行事实总结
            if (hasTools) {
                payload.tools = availableTools;
                payload.tool_choice = 'auto';
            }

            const controller = new AbortController();
            const timeout = scenario === 'REFINING' ? 30000 : 12000; // [V3.7.1] 人设提炼与大意图逻辑放宽超时
            const timeoutId = setTimeout(() => controller.abort(), timeout);

            const response = (await this.openai.chat.completions.create(payload, { signal: controller.signal })) as any;
            clearTimeout(timeoutId);

            const message = response.choices[0]?.message;
            const content = message?.content || "";

            // [V3.6.10] 记录审计日志
            // [修正] 严格记录当前的运行场景，不再使用默认 fallback 以防混淆
            LlmLogger.log({ source, scenario, callId, model: sleModel }, sleMessages as any[], content, (response as any).usage as any);

            if (content) {
                try {
                    parsed = JSON.parse(content);
                    sleIntent = parsed.intent || "";
                    if (parsed.thought) {
                        console.log(`[SLE Thought] ${parsed.thought}`);
                    }
                    // [V3.6.4] 协议对齐：优先使用 direct_response，兼容 legacy 的 response 字段
                    sleFullOutput = parsed.direct_response || parsed.response || "";
                    // parsed 已经在上面更新完了
                } catch (e: any) {
                    console.error("[SLE JSON Parse Error]", e.message, content);
                    sleFullOutput = content;
                }
            }

            if (message?.tool_calls) {
                toolCalls = message.tool_calls;
            }

            // [V3.7] 确定性绑定：当模型明确设置了意图（intent）但忘记生成 tool_calls 时，
            // 依据受控注册表执行强绑定。这从根本上解决了并发子路中模型输出不稳定的问题。
            if (!toolCalls.length && sleIntent && scenario !== 'SUMMARIZING' && !isInternal) {
                const registry = SkillRegistry.getInstance();
                const skill = registry.getSkill(sleIntent);
                if (skill && skill.parameters?.required?.length === 1) {
                    const argKey = skill.parameters.required[0];
                    toolCalls = [{
                        id: `bind-${Math.random().toString(36).substring(7)}`,
                        type: 'function',
                        function: {
                            name: sleIntent,
                            arguments: JSON.stringify({ [argKey]: text })
                        }
                    }];
                    console.log(`[SLE Engine][${callId}] 🔗 Intent Bound: ${sleIntent}`);
                }
            }

            // [V3.6.10] 补充最终输出到日志
            if (sleFullOutput) {
                LlmLogger.log({ source, scenario: `${scenario}_RESULT`, callId, model: sleModel }, [], sleFullOutput);
            }
            if (toolCalls.length > 0) {
                 LlmLogger.log({ source, scenario: `${scenario}_TOOLS`, callId, model: sleModel }, [], JSON.stringify(toolCalls.filter(tc => tc !== undefined)));
            }

            if (toolCalls.length > 0) {
                await this.toolResultHandler.handleToolCalls(
                    toolCalls.filter(tc => tc !== undefined),
                    text, callId, canvas, canvasManager, taskId, tracker  // [V3.7.2] 传递 tracker
                );
            }
        } catch (e: any) {
            console.error("[SLE Engine Error]", e.message);
        }
        return { output: sleFullOutput, toolCalls: toolCalls.filter(tc => tc !== undefined), intent: sleIntent, parsed };
    }
}
