import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { FastAgentResponse } from './types';
import { TextCleaner } from '../utils/text-cleaner';
import { ResultSummarizer } from './result-summarizer';
import { ToolResultHandler } from './tool-result-handler';

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
        initialText: string,
        fullSoul: string,
        callId: string,
        canvasManager: CanvasManager,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        forceToolIntent?: string
    ): Promise<string> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
        let sleFullOutput = "";

        try {
            const sleMessages = [
                {
                    role: 'system', content: `
${fullSoul}

# 虚拟触发指令 (Internal Trigger)
- 如果当前输入是 "__INTERNAL_TRIGGER__"，表示后台任务刚刚出结果了。
- 你必须查阅画布状态并根据实际数据进行客观分析。
- 严禁在此模式下产生任何自然语言推流。

# 行动指令 (Action Protocol)
- 当用户提到“查看、查找、搜索、发邮件、读文件、删除文件”时，你必须立即调用 \`delegate_openclaw\` 工具。
- 不要解释，直接执行工具。
- 任务执行结果会自动由系统摘要并由管家汇报，你只需要开启任务或提炼数据即可。

# 严禁幻觉 (No Hallucination)
- 如果工具调用返回结果为空或报错，你必须在画布中真实记录原因。
- 严禁捏造事实或列举不存在的结果。
` },
                ...messages.slice(0, -1),
                { role: 'user', content: text },
                { role: 'assistant', content: initialText }
            ];

            const payload: any = {
                model: sleModel,
                messages: sleMessages as any,
                stream: true,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'delegate_openclaw',
                            description: '委派复杂任务给主控助理。',
                            parameters: {
                                type: 'object',
                                properties: { intent: { type: 'string', description: '委派意图' } }
                            }
                        }
                    }
                ]
            };

            let toolCalls: any[] = [];
            let sleContentBuffer = "";

            if (forceToolIntent) {
                toolCalls.push({
                    function: { arguments: JSON.stringify({ intent: forceToolIntent }) }
                });
            } else {
                const stream = (await this.openai.chat.completions.create(payload)) as any;
                let isFilteringMode = false;
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.tool_calls) {
                        for (const toolCall of delta.tool_calls) {
                            if (!toolCalls[toolCall.index]) {
                                toolCalls[toolCall.index] = { ...toolCall };
                            } else if (toolCall.function?.arguments) {
                                toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                            }
                        }
                    }
                    if (delta?.content) {
                        const chars = delta.content.split('');
                        for (const char of chars) {
                            if (char === '(' || char === '[') { isFilteringMode = true; continue; }
                            if (isFilteringMode) {
                                if (char === ')' || char === ']') isFilteringMode = false;
                                continue;
                            }
                            sleContentBuffer += char;
                        }

                        if (sleContentBuffer.match(/\[调用|delegate_|\[delegate_|{"intent":|\[\{/)) {
                            sleContentBuffer = "";
                            continue;
                        }

                        if (!toolCalls.some(tc => tc !== undefined) && sleContentBuffer.length > 0) {
                            const cleanFrag = TextCleaner.clean(sleContentBuffer);
                            if (cleanFrag) sleFullOutput += cleanFrag;
                            sleContentBuffer = "";
                        }
                    }
                }
            }

            if (toolCalls.length > 0) {
                await this.toolResultHandler.handleToolCalls(
                    toolCalls.filter(tc => tc !== undefined),
                    text, callId, canvas, canvasManager
                );
            }
        } catch (e: any) {
            console.error("[SLE Engine Error]", e.message);
        }
        return sleFullOutput;
    }
}
