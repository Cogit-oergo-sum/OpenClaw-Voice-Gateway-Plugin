import OpenAI from 'openai';
import { FastAgentResponse } from './types';
import { PluginConfig } from '../types/config';
import { PromptAssembler } from './prompt-assembler';
import { ShadowManager } from './shadow-manager';
import { getCurrentCallId } from '../context/ctx';
import { buildShadowThought, ShadowThoughtType } from './prompts';
import { LlmLogger } from '../utils/llm-logger';
import { CanvasManager } from './canvas-manager';
import { TextCleaner } from '../utils/text-cleaner';

/**
 * [V3.2.0] SLCEngine: 交互魂魄引擎
 * 职责：极速响应、情绪共鸣、语意缝合
 */
export class SLCEngine {
    private slcClient: OpenAI;

    constructor(
        private config: PluginConfig, 
        private promptAssembler: PromptAssembler,
        private canvasManager: CanvasManager
    ) {
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
        lastSpokenFragment: string,
        directResponse: string,
        shadowManager: ShadowManager,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        dialogueMessages: any[] = [],
        isNewSession: boolean = false
    ): Promise<string> {
        let slcFullText = "";
        try {
            const isInternal = text === '__INTERNAL_TRIGGER__';
            const isIdle = text === '__IDLE_TRIGGER__';
            const isWaiting = text === '__TOOL_WAITING_TRIGGER__';
            const isPolish = text === '__REPLY_POLISH_TRIGGER__';

            // [V3.6.10] 确定请求来源
            let source = 'User-Input';
            if (isInternal) source = 'Async-Result-Delivery';
            else if (isIdle) source = 'Watchdog-Idle';
            else if (isWaiting) source = 'Tool-Waiting';
            else if (isPolish) source = 'Reply-Polishing';

            const callId = getCurrentCallId() || 'global';
            const state = shadowManager.getOrCreateState(callId);
            const slcPrompt = await this.promptAssembler.assemblePrompt('SLC', callId, state, isNewSession);

            const messages: any[] = [
                { role: 'system', content: slcPrompt }
            ];

            // 补充历史记录 (SLC 现在作为对话灵魂，需要全量上下文)
            // [V3.6.17] 智能合并：合并历史中连续的相同角色消息，避免上下文污染/角色序列错误
            const recentContext: any[] = [];
            const filteredHistory = dialogueMessages.filter(m => m.role === 'user' || m.role === 'assistant');
            
            for (const msg of filteredHistory) {
                if (recentContext.length > 0 && recentContext[recentContext.length - 1].role === msg.role) {
                    recentContext[recentContext.length - 1].content += "\n" + msg.content;
                    continue;
                }
                recentContext.push({ ...msg });
            }
            messages.push(...recentContext);

            // [V3.6.4] 统一缝合逻辑：将画布状态与引导词注入潜意识；
            // [V3.6.21修复] 停止使用极其激进的 TextCleaner.decant 处理 factual summary，
            // 否则会丢失列表、括号等结构化信息，导致 AI 回复变得干瘪。
            const safeSummary = (directResponse || "").substring(0, 3000); 
            const canvas = this.canvasManager.getCanvas(callId);
            const taskStatus = canvas?.task_status?.status || 'READY';

            let shadowThought = "";
            if (isInternal) {
                const type: ShadowThoughtType = taskStatus === 'PENDING' ? 'PROGRESS_REPORT' : 'RESULT_DELIVERY';
                shadowThought = buildShadowThought(type, safeSummary);
            } else if (isIdle) {
                shadowThought = buildShadowThought('idle', safeSummary);
            } else if (isWaiting) {
                shadowThought = buildShadowThought('PROGRESS_REPORT', safeSummary);
            } else if (isPolish) {
                shadowThought = buildShadowThought('polishing', safeSummary);
            } else if (safeSummary) {
                shadowThought = buildShadowThought('chat', safeSummary);
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
                // [V3.4.7] 修正：不再将潜意识前缀存入 slcFullText，防止持久化记录遭到污染。
                // slcFullText 仅用于收集模型真正吐出的对白部分。
                slcFullText = ""; 
            }

            // [V3.6.2] FALLBACK-01: 增加对 OpenAI 推理流的超时拦截逻辑 (900ms)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.advanced?.maxResponseTimeMs || 1500);

            const slcModel = this.config.fastAgent?.slcModel || 'qwen-turbo';
            const stream = await this.slcClient.chat.completions.create({
                model: slcModel,
                messages: messages as any,
                stream: true,
                max_tokens: 150,
                temperature: 0.8
            }, { signal: controller.signal });

            clearTimeout(timeoutId);

            for await (const chunk of stream) {
                if (signal.interrupted || signal.slcDone) break;
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    let type: any = 'chat';
                    if (isInternal) type = 'internal';
                    else if (isIdle) type = 'idle';
                    else if (isWaiting) type = 'waiting';
                    else if (isPolish) type = 'chat';

                    onChunk({ content, isFinal: false, type });
                    slcFullText += content;
                }
            }

            LlmLogger.log({ source, scenario: 'SLC_CHAT', callId, model: slcModel }, messages, slcFullText);
        } catch (e: any) {
            console.warn(`[SLCEngine Error] ${e}`);
            // [V3.6.13] 即便失败也要记录审计日志，确保身份追踪链路完整
            const slcModel = this.config.fastAgent?.slcModel || 'qwen-turbo';
            const callId = getCurrentCallId() || 'global';
            const isIdle = text === '__IDLE_TRIGGER__';
            const isInternal = text === '__INTERNAL_TRIGGER__';
            let source = 'User-Input';
            if (isInternal) source = 'Async-Result-Delivery';
            else if (isIdle) source = 'Watchdog-Idle';
            
            LlmLogger.log({ source, scenario: 'SLC_CHAT', callId, model: slcModel }, (e as any).messages || [], `[ERROR] ${e.message}`);

            // [V3.6.2] FALLBACK-01: 兜底播报
            if (e.name === 'AbortError' || e.message?.includes('timeout')) {
                const fallback = this.config.advanced?.fallbackMessage || "让我想想...";
                onChunk({ content: fallback, isFinal: false, type: 'chat' });
                slcFullText += fallback;
            }
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
