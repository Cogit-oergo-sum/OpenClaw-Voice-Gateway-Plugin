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
        source: string = 'User-Input', // [V3.6.10] 增加来源标注
        scenario: import('./types').SLEScenario = 'DECIDING', // [V3.6.17] 动态场景支持
        taskId?: string // [V3.6.21] 任务追踪 ID
    ): Promise<{ output: string; toolCalls: any[]; intent: string; parsed?: any }> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
        let sleFullOutput = "";
        let toolCalls: any[] = [];
        let sleIntent = "";
        let parsed: any = null;

        try {
            // [V3.6.0] 消费场景 B (DECIDING) 专用 Payload，不再依赖 fullSoul
            const sleMessages = await promptAssembler.assembleSLEPayload(scenario, callId, {
                text,
                current_intent,
                canvasSnapshot,
                dialogueHistory: messages.slice(0, -1),
                taskOutput: canvas.task_status.summary, // [V3.6.17] 传递任务结果供 SUMMARIZING 使用
                taskIntent: current_intent
            });


            const availableTools = SkillRegistry.getInstance().getAllSchemas();

            const isInternal = text === '__INTERNAL_TRIGGER__';
            const payload: any = {
                model: sleModel,
                messages: sleMessages,
                stream: false,
                parallel_tool_calls: true,
                response_format: { type: 'json_object' }
            };

            // [V3.6.17] 核心保护：如果是内部触发指令 (Reporting)，严禁提供工具描述，强制模型仅进行事实总结
            if (availableTools.length > 0 && !isInternal) {
                payload.tools = availableTools;
                payload.tool_choice = 'auto';
            }

            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 8000); // [V3.6.4] SLE 超时放宽至 8s

            const response = (await this.openai.chat.completions.create(payload, { signal: controller.signal })) as any;
            clearTimeout(timeoutId);

            const message = response.choices[0]?.message;
            const content = message?.content || "";

            // [V3.6.10] 记录审计日志
            // [修正] 严格记录当前的运行场景，不再使用默认 fallback 以防混淆
            LlmLogger.log({ source, scenario, callId, model: sleModel }, sleMessages as any[], content);

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

            // [V3.6.15] 容错修复：如果模型在 JSON 中设定了 intent，但没有产生 tool_calls，
            // 且该 intent 准确命中了一个长耗时技能名称，则执行手动逻辑补全，防止任务卡死。
            // [V3.6.19修复] 严禁在 SUMMARIZING 场景下触发自动补全，防止摘要事实被误判为新任务意图。
            if (!toolCalls.length && sleIntent && scenario !== 'SUMMARIZING' && !isInternal) {
                const registry = SkillRegistry.getInstance();
                const skill = registry.getSkill(sleIntent);
                if (skill) {
                    console.warn(`[SLE Engine] ⚠️ Model missed native tool_call but set intent: ${sleIntent}. Auto-repairing...`);
                    // [V3.6.16] 参数映射调优：依据 Skill Schema 自动提取字段名，优先使用对话原文弥补参数缺位
                    const required = skill.parameters?.required || [];
                    const props = skill.parameters?.properties || {};

                    // [V3.6.26] 只有当工具仅需 1 个参数时，才由于模型失误进行自动补救
                    if (required.length === 1) {
                        const repairKey = required[0];
                        const repairArgs = { [repairKey]: text };

                        // 构造一个拟态 tool_call
                        toolCalls = [{
                            id: 'repair-' + Math.random().toString(36).substring(7),
                            type: 'function',
                            function: {
                                name: sleIntent,
                                arguments: JSON.stringify(repairArgs) 
                            }
                        }];
                    } else {
                        // 如果工具需要多个核心参数（如 ASR 纠错），严禁盲目自动填充，防止产生 undefined 覆盖
                        console.warn(`[SLE Engine] ⚠️ Tool ${sleIntent} requires multiple parameters (${required.join(',')}), auto-repair skipped to prevent undefined payload.`);
                    }
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
                    text, callId, canvas, canvasManager, taskId
                );
            }
        } catch (e: any) {
            console.error("[SLE Engine Error]", e.message);
        }
        return { output: sleFullOutput, toolCalls: toolCalls.filter(tc => tc !== undefined), intent: sleIntent, parsed };
    }
}
