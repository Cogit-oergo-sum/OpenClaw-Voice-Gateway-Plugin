import * as fs from 'fs';
import * as path from 'path';

/**
 * [V3.6.10] LlmLogger: LLM 请求全量审计工具
 * 职责：将所有 LLM 交互的原始消息、源、情境与响应序列化记录。
 * 日志文件：.llm_requests.log (JSONL 格式)
 */
export class LlmLogger {
    private static logPath = path.join(process.cwd(), '.llm_requests.log');

    /**
     * 写入日志条目
     * @param metadata 包含 source, scenario, callId 等上下文
     * @param request 完整的 messages 数组
     * @param response LLM 返回的响应 (流式或非流式)
     */
    static log(
        metadata: { source: string; scenario: string; callId: string; model?: string },
        request: any[],
        response: any
    ) {
        try {
            const timestamp = new Date().toISOString();
            
            // 解析响应文本 (支持流式 Chunk 或完整 OpenAI Response 对象)
            let responseText = "";
            if (typeof response === 'string') {
                responseText = response;
            } else if (response.choices && response.choices[0]) {
                responseText = response.choices[0].message?.content || JSON.stringify(response.choices[0]);
            } else {
                responseText = "[STREAMING_CHUNKS_COLLECTED_DOWNSTREAM]";
            }

            const entry = {
                timestamp,
                ...metadata,
                request,
                response: responseText
            };

            // 注意：由于是开发调试工具，使用 appendFileSync 确保写入原子性
            fs.appendFileSync(this.logPath, JSON.stringify(entry) + '\n', 'utf8');
        } catch (e) {
            console.error(`[LlmLogger] Failed to write log:`, e);
        }
    }
}
