"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.chatCompletionsHandler = chatCompletionsHandler;
const openai_1 = __importDefault(require("openai"));
/**
 * 接受 ZEGO AI Agent 传来的 LLM 请求，伪装成大模型进行结构化 SSE 返回
 */
function chatCompletionsHandler(manager, config) {
    const openai = new openai_1.default({
        apiKey: config.llm.apiKey,
        baseURL: config.llm.baseUrl
    });
    return async (req, res) => {
        try {
            const { messages, stream, model, agent_info } = req.body;
            // 依赖于 ZEGO 提供 agent_info，从中反查目前的活跃通话
            const instanceId = agent_info?.agent_instance_id;
            let currentCallState = null;
            if (instanceId) {
                for (const call of manager['activeCalls'].values()) {
                    if (call.agentInstanceId === instanceId) {
                        currentCallState = call;
                        break;
                    }
                }
            }
            // 1. 动态别名注入与上下文保护
            let finalMessages = [...messages];
            if (currentCallState && currentCallState.aliasMap.size > 0) {
                const aliasRules = Array.from(currentCallState.aliasMap.entries())
                    .map(([wrong, right]) => `"${wrong}" 必须替换为 "${right}"`)
                    .join('; ');
                const systemPrompt = `[系统最高指令] 针对用户的语音输入，请注意以下的强制发音纠错归一化规则：${aliasRules}。`;
                // 插入或合并到第一条 System Prompt
                if (finalMessages.length > 0 && finalMessages[0].role === 'system') {
                    finalMessages[0].content = systemPrompt + '\n' + finalMessages[0].content;
                }
                else {
                    finalMessages.unshift({ role: 'system', content: systemPrompt });
                }
            }
            console.log(`[chatCompletionsHandler] Received message, stream: ${stream}, found state: ${!!currentCallState}`);
            // 设置 SSE 头
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            // 助手方法：发送 SSE 数据块
            const sendSSEChunk = (content) => {
                const payload = {
                    choices: [{ delta: { content }, finish_reason: null }]
                };
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
            };
            const sendSSEStop = () => {
                const payload = {
                    choices: [{ delta: {}, finish_reason: "stop" }]
                };
                res.write(`data: ${JSON.stringify(payload)}\n\n`);
                res.write(`data: [DONE]\n\n`);
                res.end();
            };
            // 发起对大模型的第一次流式请求
            const streamResponse = await openai.chat.completions.create({
                model: config.llm.model || model || 'doubao-lite-32k',
                messages: finalMessages,
                stream: true,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'delegate_openclaw',
                            description: '当用户要求查询复杂文件、调用特定功能或系统操作时，将任务移交给主 Agent 处理。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    intent: { type: 'string', description: '用户意图说明' }
                                },
                                required: ['intent']
                            }
                        }
                    },
                    {
                        type: 'function',
                        function: {
                            name: 'get_weather',
                            description: '查询指定城市的天气状况。',
                            parameters: {
                                type: 'object',
                                properties: {
                                    city: { type: 'string', description: '城市名称，如 北京' }
                                },
                                required: ['city']
                            }
                        }
                    }
                ]
            });
            let isToolCallDetected = false;
            let currentToolCallName = '';
            let currentToolCallArgs = '';
            let fillerSent = false;
            let fullAssistantReply = '';
            for await (const chunk of streamResponse) {
                const delta = chunk.choices[0]?.delta;
                if (delta?.tool_calls) {
                    isToolCallDetected = true;
                    if (!fillerSent) {
                        // 【核心安全策略】：一旦侦测到 Tool Call，立刻下发垫话，打破 900ms 死锁！
                        // 强制附加带换行的句号，触发 TTS 引流自然换气防粘连
                        console.log(`[chatCompletionsHandler] Tool Call Detected! Sending Filler Words...`);
                        sendSSEChunk("好的，我这就为您查询。\n");
                        fillerSent = true;
                        fullAssistantReply += "好的，我这就查一下。"; // 记录到 buffer 中
                    }
                    const tc = delta.tool_calls[0];
                    if (tc.function?.name)
                        currentToolCallName += tc.function.name;
                    if (tc.function?.arguments)
                        currentToolCallArgs += tc.function.arguments;
                }
                else if (delta?.content) {
                    // 普通文本直接透传流式输出给 ZEGO
                    sendSSEChunk(delta.content);
                }
            }
            // 如果没有工具调用，就正常结束
            if (!isToolCallDetected) {
                sendSSEStop();
                if (currentCallState) {
                    currentCallState.conversationBuffer.push({ role: 'assistant', content: fullAssistantReply });
                }
                return;
            }
            // 如果检测到工具调用，这里开始工具执行的路由
            console.log(`[chatCompletionsHandler] Executing Tool: ${currentToolCallName} with args: ${currentToolCallArgs}`);
            let toolResultContent = '';
            if (currentToolCallName === 'get_weather') {
                // Mock 天气
                const args = JSON.parse(currentToolCallArgs || '{}');
                const city = args.city || '未知城市';
                toolResultContent = `系统反馈：获取到 ${city} 的天气数据为 晴朗，由本地气象局提供。`;
                // 模拟网络延迟
                await new Promise(r => setTimeout(r, 200));
            }
            else if (currentToolCallName === 'delegate_openclaw') {
                // 真实调用 OpenClaw /hooks/agent Webhook (带 Fallback)
                const args = JSON.parse(currentToolCallArgs || '{}');
                const intent = args.intent || '未知意图';
                const webhookPayload = {
                    message: `[语音通话委托]\n发源通话: ${instanceId || 'unknown'}\n意图: ${intent}\n说明: 任务完成后，请将结果执行完毕并写入系统 Memory。`,
                    name: 'voice-delegation',
                    wakeMode: 'now',
                    deliver: false
                };
                const webhookUrl = 'http://localhost:18789/hooks/agent'; // 假设主 Agent 的监听端口
                let success = false;
                let lastStatus = 0;
                let isTimeout = false;
                for (let retry = 0; retry < 3; retry++) {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 3000);
                    try {
                        console.log(`[chatCompletionsHandler] Sending POST to ${webhookUrl} (Retry: ${retry})`);
                        const hookRes = await fetch(webhookUrl, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(webhookPayload),
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);
                        lastStatus = hookRes.status;
                        if (hookRes.ok) {
                            success = true;
                            toolResultContent = `系统反馈：任务已成功委托给了主控助理。请告诉用户正在后台处理，很快就会出结果。`;
                            break;
                        }
                        else if (hookRes.status >= 500) {
                            // 50x 服务端错误，可以重试
                            await new Promise(r => setTimeout(r, 500));
                        }
                        else {
                            // 40x 等其他非网关错误，不需要重试
                            break;
                        }
                    }
                    catch (err) {
                        clearTimeout(timeoutId);
                        if (err.name === 'AbortError') {
                            isTimeout = true;
                            // 超时，直接熔断不重试
                            break;
                        }
                        else if (err.code === 'ECONNREFUSED' || err.message.includes('fetch failed')) {
                            // 网络异常可以快速重试
                            await new Promise(r => setTimeout(r, 500));
                        }
                        else {
                            break;
                        }
                    }
                }
                if (!success) {
                    const fallbackMsg = config.advanced?.fallbackMessage || "系统反馈：委托主控助理失败。请向用户致歉，说明核心处理中心当前不在线，该请求已登记但需要稍后响应。";
                    if (isTimeout) {
                        console.error(`[chatCompletionsHandler] Webhook delegate Timeout! Aborted after 3000ms.`);
                    }
                    else {
                        console.error(`[chatCompletionsHandler] Webhook delegate ERR after retries! LastStatus: ${lastStatus}`);
                    }
                    toolResultContent = fallbackMsg;
                }
            }
            else {
                toolResultContent = `系统反馈：找到未知的工具调用 ${currentToolCallName}，执行失败。`;
            }
            // 追加到新的一轮对话请求中，进行第二次 LLM 汇总
            const secondMessages = [
                ...finalMessages,
                { role: 'assistant', content: null, tool_calls: [{ id: 'call_123', type: 'function', function: { name: currentToolCallName, arguments: currentToolCallArgs } }] },
                { role: 'tool', tool_call_id: 'call_123', name: currentToolCallName, content: toolResultContent }
            ];
            const streamResponse2 = await openai.chat.completions.create({
                model: config.llm.model || model || 'doubao-lite-32k',
                messages: secondMessages,
                stream: true
            });
            let finalToolReply = '';
            for await (const chunk of streamResponse2) {
                const delta = chunk.choices[0]?.delta;
                if (delta?.content) {
                    finalToolReply += delta.content;
                    sendSSEChunk(delta.content);
                }
            }
            sendSSEStop();
            // 将最终结果写入 buffer
            if (currentCallState) {
                currentCallState.conversationBuffer.push({ role: 'assistant', content: fullAssistantReply + finalToolReply });
            }
        }
        catch (error) {
            console.error('[chatCompletionsHandler] Error:', error);
            // 流式中途抛错也应规范发送格式，避免 ZEGO 客户端崩溃
            if (!res.headersSent) {
                res.status(500).json({ error: error.message });
            }
            else {
                res.end();
            }
        }
    };
}
