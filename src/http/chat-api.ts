import { CallManager } from '../call/call-manager';
import type { PluginConfig } from '../types/config';
import { FastAgent, FastAgentResponse } from '../agent/fast-agent';

/**
 * [V1.6.0] chatCompletionsHandler: 
 * 桥接 ZEGO 与 FastAgent Parallel Relay 引擎
 */
export function chatCompletionsHandler(manager: CallManager, config: PluginConfig, fastAgent: FastAgent) {
    return async (req: any, res: any) => {
        try {
            const { messages, agent_info } = req.body;
            const instanceId = agent_info?.agent_instance_id;
            
            // 找回当前通话状态 (用于对话持久化)
            let currentCallState = null;
            if (instanceId) {
                for (const call of manager['activeCalls'].values()) {
                    if (call.agentInstanceId === instanceId) {
                        currentCallState = call;
                        break;
                    }
                }
            }

            // 设置 SSE 头
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');

            // 提取用户最后一句输入作为 FastAgent 的触发点
            const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
            const userText = lastUserMessage?.content || "";

            console.log(`[chatCompletionsHandler] Routing to FastAgent Parallel Relay. Input: "${userText}"`);

            let fullReply = "";

            await fastAgent.process(userText, (chunk: FastAgentResponse) => {
                // 将 FastAgent 的 Internal Response 转化为 OpenAI SSE 格式
                let openaiContent = "";
                
                switch(chunk.type) {
                    case 'filler':
                    case 'text':
                        openaiContent = chunk.content;
                        break;
                    case 'bridge':
                        // 音流占位，发一个空格加换行触发 TTS 换气
                        openaiContent = " \n";
                        break;
                    case 'thought':
                        // 思维链/工具通知，仅记录不播报 (或者根据配置决定)
                        console.log(`[Thought] ${chunk.content}`);
                        return; 
                }

                if (openaiContent) {
                    fullReply += openaiContent;
                    const payload = {
                        choices: [{ delta: { content: openaiContent }, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(payload)}\n\n`);
                }
            });

            // 发送 Stop 信号
            const stopPayload = {
                choices: [{ delta: {}, finish_reason: "stop" }]
            };
            res.write(`data: ${JSON.stringify(stopPayload)}\n\n`);
            res.write(`data: [DONE]\n\n`);
            res.end();

            // 写入对话历史
            if (currentCallState) {
                currentCallState.conversationBuffer.push({ role: 'assistant', content: fullReply });
            }

        } catch (error: any) {
            console.error('[chatCompletionsHandler] Error:', error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            } else {
                res.end();
            }
        }
    };
}
