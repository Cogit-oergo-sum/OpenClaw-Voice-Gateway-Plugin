import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { PromptAssembler } from './prompt-assembler';
import { LlmLogger } from '../utils/llm-logger';
import { RouterResultLite } from './types';
import { INTENT_ROUTER_LITE_PROMPT } from './prompts';

/**
 * [V4.0] IntentRouter: 极简三分类路由
 * 职责：判定 chat/canvas/task，延迟目标 ≤200ms
 * 输出：1字符 "" (chat) | "y" (canvas) | "t" (task)
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
     * [V4.0] detectIntent: 极简三分类判断
     */
    async detectIntent(
        text: string,
        messages: any[],
        promptAssembler: PromptAssembler,
        callId: string
    ): Promise<RouterResultLite> {
        // [V4.3] 测试用：跳过 Router 强制走 chat 路径，验证 SLC trigger_sle_check
        // [ARCH] slc_prompt 模式下跳过 Router，由 SLC 自身判断意图
        if (process.env.SKIP_ROUTER === 'true' || process.env.VOICE_GATEWAY_ARCH_INTENT === 'slc_prompt') {
            console.log(`[IntentRouter] 跳过Router (SKIP_ROUTER=${process.env.SKIP_ROUTER}, ARCH_INTENT=${process.env.VOICE_GATEWAY_ARCH_INTENT}), 强制返回 chat`);
            return { type: 'chat' };
        }

        const routerModel = this.config.fastAgent?.routerModel || 'qwen-turbo';
        let routingMessages: any[] = [];  // 提前声明，便于 catch 记录

        try {
            routingMessages = await promptAssembler.assembleSLEPayload('ROUTING', callId, {
                text,
                dialogueHistory: messages.slice(-3)
            });

            // 极简输出：不强制 JSON，让模型输出 1 个字符
            const streamResponse = await this.openai.chat.completions.create({
                model: routerModel,
                messages: routingMessages as any,
                max_tokens: 10,
                temperature: 0,
                stream: true
            } as any);

            let content = '';
            let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;
            for await (const chunk of streamResponse as any) {
                content += chunk.choices?.[0]?.delta?.content || '';
                if (chunk.usage) {
                    streamUsage = { prompt_tokens: chunk.usage.prompt_tokens, completion_tokens: chunk.usage.completion_tokens, total_tokens: chunk.usage.total_tokens };
                }
            }

            LlmLogger.log({ source: 'User-Input', scenario: 'ROUTING', callId, model: routerModel }, routingMessages as any[], content, streamUsage);

            const output = content.trim();

            // [V4.4] 解析增强输出："" | "y:task_id" | "t:skill_name"
            if (output === '' || output === '{}' || output === '""') {
                return { type: 'chat' };
            }

            if (output.startsWith('y')) {
                // "y" 或 "y:t_01" 或 "y:t_01,t_02"
                const idsStr = output.replace(/^y[:]?/, '').replace(/["']/g, '');
                const ids = idsStr.split(',').filter(id => id.trim());
                return { type: 'canvas', matchedTaskIds: ids };
            }

            if (output.startsWith('t')) {
                // "t" 或 "t:skill_name"
                const skillName = output.replace(/^t[:]?/, '').replace(/["']/g, '').trim();
                return { type: 'task', matchedSkill: skillName || undefined };
            }

            // 兜底：未知输出视为 task（允许误判）
            console.warn(`[IntentRouter] Unknown output "${output}", treating as task`);
            return { type: 'task' };

        } catch (e) {
            console.error(`[IntentRouter Error]`, e);
            // 记录失败日志，便于排查
            LlmLogger.log({ source: 'User-Input', scenario: 'ROUTING_ERROR', callId, model: routerModel }, routingMessages as any[], `Error: ${e instanceof Error ? e.message : String(e)}`);
            // 异常时保守返回 task，避免漏判
            return { type: 'task' };
        }
    }
}