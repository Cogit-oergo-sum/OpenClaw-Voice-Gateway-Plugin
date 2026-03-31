import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { PromptAssembler } from './prompt-assembler';
import { LlmLogger } from '../utils/llm-logger';

/**
 * [V3.3.0] IntentRouter: 意图路由与会话初始化
 * 职责：分离 SLE 中的路由逻辑，极速判定是否需要调用工具
 */
export class IntentRouter {
    private openai: OpenAI;

    constructor(private config: PluginConfig) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
    }

    /**
     * [V3.3.0] detectIntent: 快速意图识别 (Router)
     * 在 300ms 内判定是否需要调用工具，以便 SLC 决定是直接回答还是先垫词。
     */
    async detectIntent(text: string, messages: any[], promptAssembler: PromptAssembler, callId: string): Promise<{ needsTool: boolean; intent?: string; isAnswerInCanvas?: boolean }> {
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        try {
            // [V3.6.0] 消费场景 A (ROUTING) 专用 Payload，不再依赖 fullSoul
            const routingMessages = await promptAssembler.assembleSLEPayload('ROUTING', callId, {
                text,
                dialogueHistory: messages.slice(-3)
            });

            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: routingMessages as any,
                response_format: { type: 'json_object' },
                max_tokens: 50,
                temperature: 0
            });

            const content = response.choices[0]?.message?.content || '{}';
            
            // [V3.6.10] 记录 LLM 审计日志
            LlmLogger.log({ source: 'User-Input', scenario: 'ROUTING', callId, model: sleModel }, routingMessages as any[], content);

            const result = JSON.parse(content);
            return {
                needsTool: !!result.needsTool,
                intent: result.intent,
                isAnswerInCanvas: !!result.isAnswerInCanvas
            };
        } catch (e) {
            console.error(`[IntentRouter detectIntent Error]`, e);
            return { needsTool: false }; // 默认不出错则不调工具，走极速聊天
        }
    }
}
