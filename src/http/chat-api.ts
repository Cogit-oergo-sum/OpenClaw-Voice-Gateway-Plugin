import { CallManager } from '../call/call-manager';
import type { PluginConfig } from '../types/config';
import { IFastAgent, FastAgentResponse } from '../agent/types';

/**
 * [V1.6.0] chatCompletionsHandler: 
 * 桥接 ZEGO 与 FastAgent Parallel Relay 引擎
 */
export function chatCompletionsHandler(manager: CallManager, config: PluginConfig, fastAgent: IFastAgent) {
    return async (req: any, res: any) => {
        if (req.method === 'GET') {
            return res.send('[VoiceGateway] /chat/completions is online.');
        }

        const startTime = Date.now();
        const requestID = Math.random().toString(36).substring(7);
        
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
            if (!messages || !Array.isArray(messages)) {
                console.error(`[chatCompletionsHandler] [REQ_${requestID}] Invalid messages format:`, messages);
                throw new Error("messages is not iterable");
            }
            const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
            const userText = lastUserMessage?.content || "";
            const handlerStart = Date.now();

            console.log(`[chatCompletionsHandler] [REQ_${requestID}] Routing to FastAgent. Input: "${userText}"`);

            let fullReply = "";

            await fastAgent.process(userText, (chunk: FastAgentResponse) => {
                let openaiContent = "";
                
                switch(chunk.type) {
                    case 'filler':
                    case 'text':
                    case 'chat':
                    case 'internal':
                    case 'idle':
                    case 'waiting':
                        // 1. 基础清理: 移除 Markdown 符号及所有换行符（防止换行导致字幕被切割成多条消息）
                        openaiContent = chunk.content.replace(/[\*#>`~\n\r]/g, '');
                        // [V1.8.1] 移除强制换行逻辑，确保全量内容归拢在单条消息字幕中，解决部分 UI 下显示不完全的问题
                        break;
                    case 'bridge':
                        // 发送一个空格占位，驱动 ZEGO TTS 引擎提前进入就绪状态
                        openaiContent = " ";
                        break;
                    case 'thought':
                        return; 
                }

                if (openaiContent) {
                    fullReply += openaiContent;
                    const payload = {
                        choices: [{ delta: { content: openaiContent }, finish_reason: null }]
                    };
                    res.write(`data: ${JSON.stringify(payload)}\n\n`);
                }
            }, async (notifyText) => {
                // [异步通知] 当后台任务（超过5s）完成时，主动通过 ZEGO TTS 和 Context Message 触达用户
                if (instanceId) {
                    console.log(`[chatCompletionsHandler] Sending background notification to ${instanceId}`);
                    // 1. 发送语音 (TTS)
                    await manager.api.sendAgentInstanceTTS(instanceId, notifyText, 'Medium', 'Enqueue');
                    // 2. 发送文本 (AddMsg) - 这将同步上下文到客户端，协助实现字幕显示
                    await manager.api.addAgentInstanceMsg(instanceId, 'assistant', notifyText);
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

            console.log(`[chatCompletionsHandler] [REQ_${requestID}] Done. Len: ${fullReply.length}, Total: ${Date.now() - startTime}ms`);

        } catch (error: any) {
            console.error(`[chatCompletionsHandler] [REQ_${requestID}] Error:`, error);
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            } else {
                res.end();
            }
        }
    };
}
