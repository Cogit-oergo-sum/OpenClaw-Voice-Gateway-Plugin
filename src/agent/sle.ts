import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { FastAgentResponse } from './types';
import { TextCleaner } from '../utils/text-cleaner';
import { ResultSummarizer } from './result-summarizer';
import { ToolResultHandler } from './tool-result-handler';
import { SLE_ACTION_PROTOCOL, SLE_ASR_CORRECTION_PROTOCOL } from './prompts';

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

${SLE_ACTION_PROTOCOL}
${SLE_ASR_CORRECTION_PROTOCOL}
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
                    },
                    {
                        type: 'function',
                        function: {
                            name: 'correct_asr_hotword',
                            description: '纠正 ASR 识别出的错误同音词并将其推入热词权重，防止死循环幻觉。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    wrong: { type: 'string', description: 'ASR 听错的原始错别词（同音词）' },
                                    correct: { type: 'string', description: '推论出的正确表达（真词）' }
                                },
                                required: ['wrong', 'correct']
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
