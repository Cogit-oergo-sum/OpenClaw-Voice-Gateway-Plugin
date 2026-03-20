import OpenAI from 'openai';
import { FastAgentResponse } from './types';
import { PluginConfig } from '../types/config';
import { ShadowManager } from './shadow-manager';

/**
 * [V3.2.0] SLCEngine: 交互魂魄引擎
 * 职责：极速响应、情绪共鸣、语意缝合
 */
export class SLCEngine {
    private slcClient: OpenAI;

    constructor(private config: PluginConfig) {
        this.slcClient = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.slcBaseUrl || config.llm.baseUrl
        });
    }

    /**
     * SLC (Soul-Light-Chat): 极速垫词与交互缝合
     */
    async run(
        text: string,
        deliveredText: string,
        canvasSummary: string,
        shadowManager: ShadowManager,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        dialogueMessages: any[] = []
    ): Promise<string> {
        let slcFullText = "";
        try {
            const isInternal = text === '__INTERNAL_TRIGGER__';
            const isIdle = text === '__IDLE_TRIGGER__';
            const isWaiting = text === '__TOOL_WAITING_TRIGGER__';
            const slcPrompt = await shadowManager.assemblePrompt('SLC');

            const messages: any[] = [
                { role: 'system', content: slcPrompt }
            ];

            // 补充历史记录 (SLC 现在作为对话灵魂，需要全量上下文)
            const recentContext = dialogueMessages
                .filter(m => m.role === 'user' || m.role === 'assistant');
            messages.push(...recentContext);

            // 统一缝合逻辑：将画布状态与引导词注入潜意识
            let shadowThought = "";
            if (isInternal) {
                shadowThought = `(用户交代的任务已完成，结果: "${canvasSummary}"，让我告知结果)`;
            } else if (isIdle) {
                shadowThought = `(当前气氛有些安静。我应该优雅地打破沉默。我会结合上下文想一个自然的话题，或者询问用户是否需要继续刚才的任务。)`;
            } else if (isWaiting) {
                shadowThought = `(这个事情正在调用工具处理: "${canvasSummary}"，需要等一下，我**不能瞎猜和乱编**，要让用户稍等一下)`;
            } else {
                shadowThought = ``;
            }

            // [BUGFIX] 修复冗余 User 消息导致的上下文污染
            // 只有内部触发器（Internal/Idle）才需要强制塞入引导消息，
            // 正常对话或垫词模式（isWaiting）下，对话历史中已包含最新的用户消息，无需重复 push。
            if (isInternal || isIdle) {
                const triggerUserPrompt = isInternal ? "进展如何？" : "用户现在陷入了沉默，请你结合当前背景，主动发起一个自然且有意义的话题，或关心一下用户。";
                messages.push({ role: 'user', content: triggerUserPrompt });
            }

            // [V3.3.11] 潜意识缝合逻辑：将画布状态与引导词作为 Assistant 的 Pre-fill 注入
            if (shadowThought) {
                messages.push({ role: 'assistant', content: shadowThought });
                // 为了调试可视化，将完整的潜意识作为首个 chunk 发送
                onChunk({ content: shadowThought + "\n", isFinal: false, type: 'thought' });
                // 确保日志记录包含潜意识前缀
                slcFullText = shadowThought + "\n";
            }

            const stream = await this.slcClient.chat.completions.create({
                model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                messages: messages as any,
                stream: true,
                max_tokens: 150,
                temperature: 0.8
            });

            for await (const chunk of stream) {
                if (signal.interrupted || signal.slcDone) break;
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    let type: any = 'chat';
                    if (isInternal) type = 'internal';
                    else if (isIdle) type = 'idle';
                    else if (isWaiting) type = 'waiting';

                    onChunk({ content, isFinal: false, type });
                    slcFullText += content;
                }
            }
        } catch (e) {
            console.warn(`[SLCEngine Error] ${e}`);
        }
        return slcFullText;
    }

    /**
     * 温字连接
     */
    async warmUp() {
        try {
            await this.slcClient.chat.completions.create({
                model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                messages: [{ role: 'user', content: '.' }],
                max_tokens: 1
            });
            console.log('[SLCEngine] 💓 Warm-up finished.');
        } catch (e) { }
    }
}
