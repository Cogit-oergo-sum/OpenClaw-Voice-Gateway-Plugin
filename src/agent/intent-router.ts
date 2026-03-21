import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { INTENT_ROUTER_SYSTEM_PROMPT, SESSION_INIT_PROMPT } from './prompts';

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
    async detectIntent(text: string, messages: any[], fullSoul: string): Promise<{ needsTool: boolean; intent?: string }> {
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: INTENT_ROUTER_SYSTEM_PROMPT },
                    ...messages.slice(-3), // 只看最近 3 轮上下文
                    { role: 'user', content: text }
                ] as any,
                response_format: { type: 'json_object' },
                max_tokens: 50,
                temperature: 0
            });

            const content = response.choices[0]?.message?.content || '{}';
            const result = JSON.parse(content);
            return {
                needsTool: !!result.needsTool,
                intent: result.intent
            };
        } catch (e) {
            console.error(`[IntentRouter detectIntent Error]`, e);
            return { needsTool: false }; // 默认不出错则不调工具，走极速聊天
        }
    }

    /**
     * [V3.3.0] initializeSession: 会话初始化 (环境预感知)
     * 当新通话建立时，生成环境背景放入画布。
     */
    async initializeSession(callId: string, canvasManager: CanvasManager): Promise<void> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: SESSION_INIT_PROMPT },
                    { role: 'user', content: `当前环境: ${JSON.stringify(canvas.env)}` }
                ] as any,
                max_tokens: 100,
                temperature: 0.7
            });

            const summary = response.choices[0]?.message?.content || "系统已就绪。";
            canvas.task_status.summary = summary;
            canvas.task_status.status = 'READY';
            canvas.task_status.is_delivered = true;
            canvas.task_status.version = Date.now();
            await canvasManager.logCanvasEvent(callId, 'SESSION_INITIALIZED', { summary });
        } catch (e) {
            console.error(`[IntentRouter initializeSession Error]`, e);
        }
    }
}
