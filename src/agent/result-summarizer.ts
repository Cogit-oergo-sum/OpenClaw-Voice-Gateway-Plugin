import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { TASK_RESULT_SUMMARIZER_PROMPT, PERSONA_SYNTHESIZER_PROMPT } from './prompts';

/**
 * [V3.3.0] ResultSummarizer: 结果与人设摘要专家
 * 职责：专门负责将复杂的 LLM 原始输出或上下文提炼为高密度的摘要。
 */
export class ResultSummarizer {
    private openai: OpenAI;

    constructor(private config: PluginConfig) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
    }

    /**
     * summarizePersona: 核心人设高精度提炼
     * 基于全量原始信息（soul, user, memory等），生成一段精准的 SLC 运行指南。
     */
    async summarizePersona(fullContext: string): Promise<string> {
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: PERSONA_SYNTHESIZER_PROMPT },
                    { role: 'user', content: `[原始全量上下文]\n${fullContext}` }
                ] as any,
                max_tokens: 1500,
                temperature: 0.3
            });

            return response.choices[0]?.message?.content || "你是 Jarvis。用户是先生。";
        } catch (e) {
            console.error(`[ResultSummarizer summarizePersona Error]`, e);
            return "你是 Jarvis。用户是先生。";
        }
    }

    /**
     * summarizeTaskResult: 任务结果摘要
     * 将工具运行的原始 stdout/stderr 提炼为可读性强的摘要。
     */
    async summarizeTaskResult(rawOutput: string, intent: string): Promise<{ direct_response: string; extended_context: string }> {
        const safeIntent = (intent || "处理任务").substring(0, 100);
        const safeOutput = (rawOutput || "任务执行完毕，未获取到结果详细。").trim();

        try {
            const resp = await this.openai.chat.completions.create({
                model: this.config.fastAgent?.sleModel || this.config.llm.model,
                messages: [{ 
                    role: 'system', 
                    content: TASK_RESULT_SUMMARIZER_PROMPT(safeIntent, safeOutput.substring(0, 3000)) 
                }] as any,
                response_format: { type: 'json_object' },
                temperature: 0.1,
                max_tokens: 500
            });

            const content = resp.choices[0]?.message?.content;
            if (content && content.trim()) {
                const parsed = JSON.parse(content);
                return {
                    direct_response: parsed.direct_response || "任务已完成。",
                    extended_context: parsed.extended_context || ""
                };
            }
            throw new Error("LLM returned empty summary");
        } catch (e) {
            console.error(`[ResultSummarizer summarizeTaskResult Exception]`, e);
            const isError = safeOutput.match(/error|fail|failed|错误|失败/i);
            const prefix = isError ? "⚠️ 任务结果汇报：" : "✅ 任务结果汇报：";
            return {
                direct_response: `${prefix}${safeOutput.substring(0, 100)}`,
                extended_context: ""
            };
        }
    }
}
