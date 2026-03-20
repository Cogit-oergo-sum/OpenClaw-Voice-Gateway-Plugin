import OpenAI from 'openai';
import { ShadowManager } from './shadow-manager';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';
import * as fs from 'fs';
import * as path from 'path';

import { FastAgentResponse, IFastAgent } from './types';
export { FastAgentResponse, IFastAgent };

/**
 * FastAgent 核心类：实现【影子锚点 (Anchor Reflection) 语意缝合】架构 V2.3.0
 * 遵循 fast_agent_design.md v1.8.5 规范
 */
export class FastAgent implements IFastAgent {
    private openai: OpenAI;
    private slcClient: OpenAI;
    private shadow: ShadowManager;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private compactPersona: string = "你是 Jarvis。用户是 先生。";

    constructor(private config: PluginConfig, private workspaceRoot: string) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
        
        this.slcClient = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.slcBaseUrl || config.llm.baseUrl
        });
        
        this.shadow = new ShadowManager(workspaceRoot);
        this.startKeepAlive();
        this.refreshCompactPersona(); 
    }

    private async refreshCompactPersona() {
        try {
            this.compactPersona = await this.shadow.getCompactPersona();
        } catch(e) {}
    }

    private startKeepAlive() {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = setInterval(async () => {
            try {
                await this.slcClient.chat.completions.create({
                    model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                    messages: [{ role: 'user', content: '.' }],
                    max_tokens: 1
                });
                console.log('[FastAgent] 💓 Connection Warmed.');
            } catch (e) {}
        }, 50000); 
    }

    /**
     * [P0] 将汇报内容转化为管家身份的自然话术
     */
    private async asButler(content: string, contextHint?: string): Promise<string> {
        try {
            const resp = await this.slcClient.chat.completions.create({
                model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                messages: [
                    { role: 'system', content: `你是一个优雅的英国管家 Jarvis。
任务：将后台任务的结果报告转化为一段极其自然、体面、且带有温度的口语化回复。
【硬性准则】:
1. 严禁复读任务、系统、JSON、状态、处理等词汇。
2. 严禁使用“已经、正在、成功、失败”。
3. 听起来像是你在走廊里轻声告知主人：“那个文件我给您弄好了，就在桌上。”
4. 字数控制在15字以内。
${contextHint ? `执行背景: ${contextHint}` : ''}` },
                    { role: 'user', content: `报告内容: ${content}` }
                ],
                max_tokens: 50,
                temperature: 0.7
            });
            return resp.choices[0]?.message?.content?.trim() || content;
        } catch (e) {
            return content;
        }
    }

    async process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string, trace?: string[]) => Promise<void>,
        callIdOverride?: string
    ) {
        const totalStart = performance.now();
        let isTurnActive = true; 
        const callId = callIdOverride || getCurrentCallId() || 'anonymous';
        
        // 🚀 [V3.3.9] SSOT 内存恢复
        const managedMessages = await this.shadow.getHistoryMessages(callId, 10);
        if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__') {
            await this.shadow.logDialogue(callId, 'user', text);
            managedMessages.push({ role: 'user', content: text });
        }
        
        let deliveredText = ""; 
        let semanticAnchor = ""; // [V2.3.0] 重点：仅存储具有语意连续性的文本，排除垫词
        let isToolCallDetected = false;
        let isProcessingToolResult = false; // [V2.3.0] 工具结果处理中标识
        let streamHandoff = false;
        let slcBuffer: string[] = [];
        let slcDone = false;

        // 1. 发送静默占位，建立链路
        onChunk({ content: " ", type: 'bridge', isFinal: false });

        // --- [影子哨兵] 动态垫词控制 V2.3.0 ---
        let lastOutputTime = performance.now();
        const usedFillers = new Set<string>();
        const watchdog = setInterval(() => {
            const now = performance.now();
            // 如果 SLE 已经在吐字，或者正在处理工具结果，哨兵必须闭嘴
            if (streamHandoff || isProcessingToolResult) return;

            const silenceThreshold = isToolCallDetected ? 5000 : 2500; 
            if (isTurnActive && (now - lastOutputTime > silenceThreshold)) {
                let fillers = isToolCallDetected 
                    ? ["我正在为您处理，这请稍后...", "请稍等，我正在与主脑同步确认细节...", "主脑反馈稍慢，我盯着呢..."]
                    : ["先生...", "让我想想...", "如果是这样的话...", "我想一下..."];
                
                fillers = fillers.filter(f => !usedFillers.has(f));
                if (fillers.length === 0) return; 

                const picked = fillers[Math.floor(Math.random() * fillers.length)];
                usedFillers.add(picked);

                console.log(`[FastAgent] Watchdog triggered. Injecting: ${picked}`);
                onChunk({ content: picked, isFinal: false, type: 'filler' });
                deliveredText += picked; 
                lastOutputTime = now; 
            }
        }, 1000);

        // 2. [V2.0.0 并联加速] SLC 与 Shadow 恢复同时启动
        const shadowPromise = (async () => {
            await this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } });
            await this.shadow.recover(callId);
            const soul = await this.shadow.getContextPrompts();
            this.refreshCompactPersona(); 
            await this.shadow.logDialogue(callId, 'user', text);
            return soul;
        })();

        // SLC (快速魂魄) - 负责 300ms 内的“开口”
        const slcPromise = (async () => {
            try {
                const stream = await this.slcClient.chat.completions.create({
                    model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                    messages: [
                        { role: 'system', content: `${this.compactPersona}
任务：给出一个极其精简（1-3字）且能引导后续句子的语气词或称谓。
【绝对禁令】: 严禁说“好的、明白、收到、查一下、已经、处理”。
【推荐】: "先生，"、"噢？"、"确实，"、"这个..."、"如果是这样，"` },
                        { role: 'user', content: text }
                    ] as any,
                    stream: true,
                    max_tokens: 10,
                    temperature: 0.8 
                });

                for await (const chunk of stream) {
                    if (streamHandoff) break;
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        lastOutputTime = performance.now();
                        slcBuffer.push(content);
                        deliveredText += content;
                        semanticAnchor += content; // [V2.3.0] 语义锚点累加
                        if (slcBuffer.length >= 1) {
                            onChunk({ content: slcBuffer.join(''), isFinal: false, type: 'filler' });
                            slcBuffer = [];
                        }
                    }
                }
                slcDone = true;
            } catch (e) {
                console.warn(`[SLC Error] ${e}`);
                slcDone = true;
            }
        })();

        // SLE (主控魂魄) - 接力、缝合、逻辑
        const slePromise = (async () => {
            const fullSoul = await shadowPromise;
            const waitStart = performance.now();
            while (!slcDone && semanticAnchor.length < 2 && (performance.now() - waitStart < 400)) {
                await new Promise(r => setTimeout(r, 50));
            }

            const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
            
            try {
                const initialText = semanticAnchor.trim() || " "; 
                const sleMessages = [
                    { role: 'system', content: `
${fullSoul}

# 影子锚点接力指令
1. 刚才我已先替你开口说了: "${initialText}"
2. 你必须保持【语意缝合】，从这个“锚点”衔接下去，完成接龙。
3. 严格禁止在开头重复 "${initialText}"。
4. **行动派要求**：如果用户提到“查看、查找、搜索、发邮件、读文件（包括doc目录下）”，请立即调用 \`delegate_openclaw\` 工具，不要解释。
5. 保持极其口语化，像一个真实的管家在贴耳交流。` },
                    ...managedMessages.slice(0, -1),
                    { role: 'user', content: text },
                    { role: 'assistant', content: initialText } 
                ];

                const stream = await this.openai.chat.completions.create({
                    model: sleModel,
                    messages: sleMessages as any,
                    stream: true,
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'delegate_openclaw',
                                description: '委派复杂任务（搜文件、读doc、发邮件等）给主控助理。',
                                parameters: {
                                    type: 'object',
                                    properties: { intent: { type: 'string', description: '清晰的委派意图' } }
                                }
                            }
                        }
                    ]
                });

                let toolCalls: any[] = [];
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.content || delta?.tool_calls) {
                        streamHandoff = true; 
                    }

                    if (delta?.tool_calls) {
                        for (const toolCall of delta.tool_calls) {
                            if (!toolCalls[toolCall.index]) {
                                toolCalls[toolCall.index] = { ...toolCall };
                            } else if (toolCall.function?.arguments) {
                                toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                            }
                        }
                        isToolCallDetected = true;
                    } else if (delta?.content) {
                        // 🚀 [V2.3.1] 净化防护：拦截模型在工具调用前的机械化内心独白
                        const content = delta.content;
                        if (content.match(/\[调用|delegate_|\[delegate_|{"intent":/) || (isToolCallDetected && content.length < 5)) {
                            console.log(`[FastAgent] Filtered mechanical leak: ${content}`);
                            continue;
                        }

                        lastOutputTime = performance.now();
                        onChunk({ content, isFinal: false, type: 'text' });
                        deliveredText += content;
                    }
                }

                if (isToolCallDetected) {
                    isProcessingToolResult = true; // [V2.3.0] 标记开始处理结果，哨兵永久闭嘴
                    const finalToolCalls = toolCalls.filter(tc => tc !== undefined);
                    const toolResults = await Promise.all(finalToolCalls.map(async (tc) => {
                        const args = JSON.parse(tc.function.arguments || '{}');
                        const contextEnv = await this.shadow.getRecentDialogueContext(3);
                        const intent = contextEnv + (args.intent || "") + " (请务必检查工作区中的 doc/ 或相关文档)";
                        
                        let result = "";
                        try {
                            const { exec } = require('child_process');
                            const { promisify } = require('util');
                            const execAsync = promisify(exec);
                            
                            const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
                            const command = `openclaw agent --agent main --session "${callId}" --message "${intent.replace(/"/g, '\\"')}" --json`;
                            
                            const cliPromise = execAsync(command, {
                                env: { 
                                    ...process.env, 
                                    OPENCLAW_HOME: openclawHome,
                                    OPENCLAW_PROFILE: this.workspaceRoot,
                                    OPENCLAW_WORKSPACE: this.workspaceRoot
                                },
                                timeout: 60000 
                            });
                            
                            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT_5S')), 5000));
                            
                            try {
                                const { stdout } = await Promise.race([cliPromise, timeoutPromise]) as any;
                                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    const data = JSON.parse(jsonMatch[0]);
                                    result = (data.result?.payloads && data.result.payloads[0]?.text)
                                           || (data.payloads && data.payloads[0]?.text)
                                           || data.content || data.message || JSON.stringify(data);
                                } else {
                                    result = stdout || "已办妥。";
                                }
                            } catch (err: any) {
                                if (err.message === 'TIMEOUT_5S') {
                                    result = "[BACKGROUND_MODE] 这件事稍微有点复杂，我交托主脑去办了。您先忙，办好了我立刻叫您。";
                                    cliPromise.then(async ({ stdout }: any) => {
                                        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                                        let finalRes = stdout;
                                        if (jsonMatch) {
                                            const data = JSON.parse(jsonMatch[0]);
                                            finalRes = (data.result?.payloads && data.result.payloads[0]?.text)
                                                   || (data.payloads && data.payloads[0]?.text)
                                                   || data.content || data.message || finalRes;
                                        }
                                        const butlerMsg = await this.asButler(finalRes, intent);
                                        await this.shadow.logDialogue(callId, 'assistant', butlerMsg);
                                        if (notifier) await notifier(butlerMsg);
                                    }).catch((e: any) => console.error(`[Background Error] ${e.message}`));
                                } else {
                                    throw err;
                                }
                            }
                        } catch (e: any) {
                            result = `委派出了点状况: ${e.message}`;
                        }
                        return { role: 'tool', tool_call_id: tc.id, content: result };
                    }));

                    const isBackground = toolResults.some(r => r.content.includes('[BACKGROUND_MODE]'));
                    const followUpMessages = [
                        ...sleMessages,
                        { 
                            role: 'assistant', 
                            content: null, 
                            tool_calls: finalToolCalls.map(tc => ({
                                id: tc.id,
                                type: 'function',
                                function: { name: tc.function.name, arguments: tc.function.arguments }
                            }))
                        },
                        ...toolResults,
                        {
                            role: 'system',
                            content: isBackground
                                ? `[转场指令]：任务已进入后台处理。请以管家的口吻告知主人，语气要放松。
【要求】：
1. 严禁复读任务、背景、后台等技术词汇。
2. 虽然任务在继续，但请表现得事情已经在掌控之中。
3. 示例：“先生，这需要花点工夫，我替您盯着，结果一出来就告诉您。”`
                                : `[回执指令]：主脑任务已完成。请以管家的口吻简洁概括结论。
【要求】：
1. 严禁说“已经、反馈、结果”。
2. 直接说出主人最想听到的那个事实或动作结果。
3. 示例：“先生，那份清单我理好了，就在您手边。”`
                        }
                    ];

                    const followUpStream = await this.openai.chat.completions.create({
                        model: sleModel,
                        messages: followUpMessages as any,
                        stream: true
                    });

                    for await (const chunk of followUpStream) {
                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            lastOutputTime = performance.now();
                            onChunk({ content, isFinal: false, type: 'text' });
                            deliveredText += content;
                        }
                    }
                }
            } catch (e: any) {
                console.error("[SLE Error]", e.message);
                onChunk({ content: `\n[系统提示] 暂时断开了与逻辑魂魄的连接: ${e.message}`, isFinal: false, type: 'text' });
            }
        })();

        await Promise.all([slcPromise, slePromise]);
        if (deliveredText.trim()) {
            await this.shadow.logDialogue(callId, 'assistant', deliveredText);
        }

        isTurnActive = false;
        clearInterval(watchdog);
        onChunk({ content: '', isFinal: true, type: 'text' });
        console.log(`[Perf][${callId}] Process Finished in ${(performance.now() - totalStart).toFixed(2)}ms`);
    }

    destroy() {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    }
}
