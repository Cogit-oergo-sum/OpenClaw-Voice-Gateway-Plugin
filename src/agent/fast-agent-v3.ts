import OpenAI from 'openai';
import { ShadowManager } from './shadow-manager';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';
import { FastAgentResponse, IFastAgent } from './types';
import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Canvas 状态结构
 */
interface CanvasState {
    env: { time: string; weather: string };
    task_status: {
        status: 'READY' | 'PENDING';
        version: number;
        current_progress: number;
        importance_score: number;
        is_delivered: boolean;
        summary: string;
    };
    context: {
        last_spoken_fragment: string;
        interrupted: boolean;
    };
}

/**
 * Fast Agent V3: 核心方案实现
 * 遵循 fast_agent_v3.md 规范
 * 采用 SLC (交互层) 与 SLE (逻辑层) 解耦架构
 */
export class FastAgentV3 implements IFastAgent {
    private openai: OpenAI;
    private slcClient: OpenAI;
    private shadow: ShadowManager;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private compactPersona: string = "你是 Jarvis。用户是 先生。";
    
    // Canvas 内存存储 (按会话隔离)
    private canvases: Map<string, CanvasState> = new Map();
    private notifiers: Map<string, (text: string) => Promise<void>> = new Map();
    private scanTimer: NodeJS.Timeout | null = null;
    private logDir: string;
    private instanceId: string = Math.random().toString(36).substring(7);
    
    /**
     * [V3.1.6] Canvas 审计日志：记录状态机所有流转轨迹
     */
    private async logCanvasEvent(callId: string, event: string, detail: any) {
        try {
            if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            const entry = {
                timestamp: new Date().toISOString(),
                callId,
                event,
                detail,
                state: this.canvases.get(callId)
            };
            await fs.promises.appendFile(logPath, JSON.stringify(entry) + '\n');
            console.log(`[CanvasLog][${callId}] ${event}: ${JSON.stringify(detail)}`);
        } catch (e) {
            console.error('[CanvasLog] Failed to log event:', e);
        }
    }


    constructor(private config: PluginConfig, private workspaceRoot: string) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
        
        this.slcClient = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.slcBaseUrl || config.llm.baseUrl
        });
        
        this.logDir = path.join(workspaceRoot, 'logs');
        this.shadow = new ShadowManager(workspaceRoot);
        this.startKeepAlive();
        this.startWatchdog(); 
        this.refreshCompactPersona(); 
        console.log(`[FastAgentV3] Instance created for workspace: ${this.workspaceRoot}`);
    }


    private async refreshCompactPersona() {
        try {
            this.compactPersona = await this.shadow.getCompactPersona();
        } catch(e) {}
    }

    destroy() {
        console.log(`[FastAgentV3] Instance destroying... flushing timers.`);
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.notifiers.clear();
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
                console.log('[FastAgentV3] 💓 Connection Warmed.');
            } catch (e) {}
        }, 50000); 
    }

    /**
     * [V3.1.5] Watchdog Scanner: 每 500ms 扫描 Canvas 状态
     * 遵循 fast_agent_v3.md 规范，主动触发 READY 状态的播报
     * 特性：剥离原 SLE 内部抢跑通知，由心跳统一收口
     */
    private startWatchdog() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        console.log(`[Watchdog] 🛡️ Started. Scanning interval: 1000ms`);
        
        let heartbeatCount = 0;

        this.scanTimer = setInterval(async () => {
            heartbeatCount++;
            if (heartbeatCount % 10 === 0) { 
                const details = Array.from(this.canvases.entries()).map(([id, c]) => 
                    `${id}(${c.task_status.status},is_del=${c.task_status.is_delivered},notif=${!!this.notifiers.get(id)})`
                ).join(', ');
                console.log(`[Watchdog][${this.instanceId}] 💓 Heartbeat: ${this.canvases.size} canvases: [${details || 'none'}]`);
            }

            for (const [callId, canvas] of this.canvases.entries()) {
                const status = canvas.task_status;
                
                // 仅扫描 READY 且未播报的单元
                if (status.status === 'READY' && !status.is_delivered) {
                    if (status.importance_score < 0.7) continue;

                    // 🚀 [V3.1.9] 关键修复：立即标记投递中，防止并发心跳重复触发
                    status.is_delivered = true; 

                    const notifier = this.notifiers.get(callId);
                    if (notifier) {
                        console.log(`[Watchdog][${this.instanceId}] 📣 TRIGGERING for ${callId}: "${status.summary.substring(0, 30)}..."`);
                        await this.logCanvasEvent(callId, 'WATCHDOG_TRIGGER', { summary: status.summary });
                        
                        try {
                            const butlerMsg = await this.asButler(status.summary, "后台任务汇报");
                            await notifier(butlerMsg);
                            console.log(`[Watchdog][${this.instanceId}] ✅ Delivered to ${callId}`);
                            await this.shadow.logDialogue(callId, 'assistant', butlerMsg);
                            await this.logCanvasEvent(callId, 'WATCHDOG_DELIVERED', { butlerMsg });
                        } catch (e) {
                            console.error(`[Watchdog][${this.instanceId}] ❌ Delivery Failed for ${callId}:`, e);
                            status.is_delivered = false; // 允许下次重试
                        }
                    } else {
                        status.is_delivered = false; // 等待 notifier 就位后再触发
                        if (heartbeatCount % 5 === 0) {
                            console.warn(`[Watchdog][${this.instanceId}][${callId}] ⚠️ READY but NO NOTIFIER yet.`);
                        }
                    }
                }
            }
        }, 1000);
    }


    private getCanvas(callId: string): CanvasState {
        if (!this.canvases.has(callId)) {
            this.canvases.set(callId, {
                env: { time: new Date().toLocaleTimeString(), weather: 'Unknown' },
                task_status: {
                    status: 'PENDING',
                    version: Date.now(),
                    current_progress: 0,
                    importance_score: 0,
                    is_delivered: false,
                    summary: ''
                },
                context: {
                    last_spoken_fragment: '',
                    interrupted: false
                }
            });
            this.logCanvasEvent(callId, 'CANVAS_INIT', {});
        }
        return this.canvases.get(callId)!;
    }

    /**
     * SLC (Soul-Light-Chat): 极速垫词与交互缝合
     */
    private async runSLC(
        text: string, 
        deliveredText: string, 
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean }
    ): Promise<string> {
        let slcFullText = "";
        try {
            const stream = await this.slcClient.chat.completions.create({
                model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                messages: [
                    { role: 'system', content: `${this.compactPersona}
任务：给出一个极其精简（1-3字）且能引导后续句子的语气词、称谓或情绪共鸣。
【原则】：极速响应，不作为，等待大脑。
【推荐】： "先生，"、"噢？"、"确实，"、"我这就办..."` },
                    { role: 'user', content: text }
                ] as any,
                stream: true,
                max_tokens: 20,
                temperature: 0.8 
            });

            for await (const chunk of stream) {
                if (signal.interrupted || signal.slcDone) break;
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    onChunk({ content, isFinal: false, type: 'filler' });
                    slcFullText += content;
                }
            }
        } catch (e) {
            console.warn(`[V3 SLC Error] ${e}`);
        }
        return slcFullText;
    }

    private async asButler(result: string, intent: string): Promise<string> {
        const prompt = `你是一个优雅的英式管家 Jarvis。
用户之前的意图是: "${intent}"
主脑执行任务的结果是: "${result}"

请以管家的口吻汇报任务完成。
要求：
1. 极其简洁，直接说重点。
2. 即使任务失败或超时，也要表现得非常有礼貌且在掌控之中。
3. 严禁复读任何技术标签如 "[上下文记忆: ...]"、"(潜意识: ...)" 或主脑汇报的原始日志。`;

        try {
            const resp = await this.openai.chat.completions.create({
                model: this.config.fastAgent?.sleModel || this.config.llm.model,
                messages: [{ role: 'system', content: prompt }] as any,
                temperature: 0.7,
                max_tokens: 150
            });
            let reply = resp.choices[0]?.message?.content || "先生，办妥了。";
            // 🚀 [V3.1.5] 最终防御：强制激进抹除可能的标签残留
            return reply.replace(/[\(\[].*?[\)\]]/g, '').replace(/[\(\[].*$/g, '').trim();
        } catch (e) {
            return "先生，事情已经办妥了。";
        }
    }


    /**
     * SLE (Soul-Logic-Expert): 逻辑推演与画布生产
     */
    private async runSLE(
        messages: any[],
        text: string,
        initialText: string,
        fullSoul: string,
        onChunk: (resp: FastAgentResponse) => void,
        callId: string,
        signal: { interrupted: boolean; slcDone: boolean },
        notifier?: (text: string) => Promise<void>
    ): Promise<string> {
        const canvas = this.getCanvas(callId);
        if (notifier) this.notifiers.set(callId, notifier);

        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        let sleFullOutput = "";

        try {
            const sleMessages = [
                { role: 'system', content: `
${fullSoul}

# SLC 接力指令
1. SLC 已经开了个头: "${initialText}"
2. 你必须保持【语意缝合】，从这个锚点衔接下去。
3. 严禁复读 "${initialText}"。

# 行动指令 (Action Protocol)
- 当用户提到“查看、查找、搜索、发邮件、读文件、删除文件”时，你必须立即调用 \`delegate_openclaw\` 工具。
- 不要解释，不要说“我这就去办”、“正在调用工具”之类的话，直接执行工具。
- 严禁在输出中包含任何类似 \`[调用 delegate_openclaw]\` 或 JSON 格式的中间思考过程。你的回复应该只包含对用户有意义的自然语言。
- 任务执行结果会自动由管家汇报，你只需要开启任务即可。
- 你的回复如果需要提及背景信息，请保持管家风范，严禁复读 "[上下文记忆: ...]" 或 "(潜意识: ...)" 等内部标签。
` },

                ...messages.slice(0, -1),
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
                            description: '委派复杂任务给主控助理。',
                            parameters: {
                                type: 'object',
                                properties: { intent: { type: 'string', description: '委派意图' } }
                            }
                        }
                    }
                ]
            });

            let toolCalls: any[] = [];
            let sleContentBuffer = "";
            let isFilteringMode = false; // 🚀 [V3.1.5] 流式过滤器闸门
            
            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;
                
                if (delta?.tool_calls) {
                    for (const toolCall of delta.tool_calls) {
                        if (!toolCalls[toolCall.index]) {
                            toolCalls[toolCall.index] = { ...toolCall };
                        } else if (toolCall.function?.arguments) {
                            toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                        }
                    }
                }

                if (delta?.content) {
                    const chars = delta.content.split('');
                    for (const char of chars) {
                        if (char === '(' || char === '[') {
                            isFilteringMode = true; // 进入拦截状态
                            console.log(`[StreamFilter] 🛑 Gate closed by '${char}'`);
                            continue;
                        }
                        if (isFilteringMode) {
                            if (char === ')' || char === ']') {
                                isFilteringMode = false; // 丢弃拦截内容，恢复输出
                                console.log(`[StreamFilter] ✅ Gate opened by '${char}'`);
                            }
                            continue; // 拦截态中，不输出任何内容
                        }
                        
                        sleContentBuffer += char;
                    }
                    
                    // 🚀 [V3.1.0] 智能过滤器后续修剪：如果内容流中包含了工具调用的特征，立即截断
                    if (sleContentBuffer.match(/\[调用|delegate_|\[delegate_|{"intent":|\[\{/)) {
                       sleContentBuffer = ""; 
                       continue;
                    }

                    // 如果此时还没有检测到 tool_calls，且缓冲区内是正常的对话内容，则适时输出
                    if (!toolCalls.some(tc => tc !== undefined) && sleContentBuffer.length > 0) {
                        signal.interrupted = true; 
                        onChunk({ content: sleContentBuffer, isFinal: false, type: 'text' });
                        sleFullOutput += sleContentBuffer;
                        sleContentBuffer = "";
                    }
                }
            }

            // 处理可能在 text 中的 JSON 画布更新
            if (sleFullOutput.includes('```json')) {
                try {
                    const jsonStr = sleFullOutput.match(/```json\s*(\{[\s\S]*?\})\s*```/)?.[1];
                    if (jsonStr) {
                        const canvasUpdate = JSON.parse(jsonStr);
                        Object.assign(canvas.task_status, canvasUpdate.task_status);
                        this.logCanvasEvent(callId, 'CANVAS_SLE_UPDATE', canvasUpdate.task_status);
                    }
                } catch(e) {}
            }

            // 工具调用处理
            if (toolCalls.length > 0) {
                const finalToolCalls = toolCalls.filter(tc => tc !== undefined);
                console.log(`[V3 SLE] Detected ${finalToolCalls.length} tool calls.`);
                for (const tc of finalToolCalls) {
                    const args = JSON.parse(tc.function.arguments || '{}');
                    const intent = args.intent || text;
                    console.log(`[V3 SLE] Executing tool: ${tc.function.name} with intent: ${intent}`);
                    
                    try {
                        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
                        // 🚀 [V3.1.7] 强制使用 --agent main 路径
                        const command = `openclaw agent --agent main --message "${intent.replace(/"/g, '\\"')}" --json`;
                        console.log(`[V3 SLE] Executing: ${command}`);
                        
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
                            const raceResult = await Promise.race([cliPromise, timeoutPromise]) as any;
                            const stdout = raceResult.stdout;
                            const stderr = raceResult.stderr;
                            
                            let result = "";
                            const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                const data = JSON.parse(jsonMatch[0]);
                                result = (data.result?.payloads && data.result.payloads[0]?.text)
                                       || (data.payloads && data.payloads[0]?.text)
                                       || data.content || data.message || JSON.stringify(data);
                            } else {
                                // 🚀 [V3.1.0] 改进错误处理：如果 stdout 为空但 stderr 有错，不应显示“已办妥”
                                if (!stdout && stderr) {
                                  result = `执行失败: ${stderr.split('\n')[0]}`;
                                } else {
                                  result = stdout || "任务已提交。";
                                }
                            }
                            
                            const butlerMsg = await this.asButler(result, intent);
                            onChunk({ content: `\n${butlerMsg}`, isFinal: false, type: 'text' });
                            sleFullOutput += butlerMsg;
                            
                        } catch (err: any) {
                            if (err.message === 'TIMEOUT_5S') {
                                const backgroundMsg = "\n先生，这需要花点工夫，我替您盯着，结果一出来就告诉您。";
                                onChunk({ content: backgroundMsg, isFinal: false, type: 'text' });
                                sleFullOutput += backgroundMsg;

                                 cliPromise.then(async ({ stdout, stderr }: any) => {
                                    const out = stdout || (stderr ? `错误: ${stderr}` : "任务完成。");
                                    
                                    // 🚀 [V3.1.5] 主动通知归位：剥离原 notifier 逻辑，仅更新 Canvas
                                    // Watchdog 会根据 status='READY' 和 is_delivered=false 发起播报
                                    canvas.task_status.summary = out;
                                     console.log(`[V3 SLE][${this.instanceId}][${callId}] 🏁 CLI Finished. Updating Canvas...`);
                                     canvas.task_status.summary = out;
                                     canvas.task_status.status = 'READY';
                                     canvas.task_status.is_delivered = false;
                                     canvas.task_status.importance_score = 1.0; 

                                     this.logCanvasEvent(callId, 'CANVAS_CLI_READY', { summary: out });
                                }).catch(e => console.error(`[V3 Background Error][${this.instanceId}][${callId}] ${e}`));

                            } else {
                                throw err;
                            }
                        }
                    } catch (e: any) {
                        console.error(`[V3 Tool Error] ${e.message}`);
                    }
                }
            }

        } catch (e: any) {
            console.error("[V3 SLE Error]", e.message);
        }
        return sleFullOutput;
    }

    async process(
        messages: any[], 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string) => Promise<void>
    ) {
        const totalStart = performance.now();
        const callId = getCurrentCallId() || 'anonymous';
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        const text = lastUserMessage?.content || "";
        
        // 1. 初始化并联
        const signal = { interrupted: false, slcDone: false };
        let slcOutput = "";

        // 占位
        onChunk({ content: " ", type: 'bridge', isFinal: false });

        // 影子恢复与记忆拼装
        const fullSoul = await (async () => {
            await this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } });
            await this.shadow.recover(callId);
            const soul = await this.shadow.getContextPrompts();
            this.refreshCompactPersona(); 
            await this.shadow.logDialogue(callId, 'user', text);
            return soul;
        })();

        // 启动 SLC
        const slcPromise = this.runSLC(text, "", onChunk, signal).then(res => {
            slcOutput = res;
            signal.slcDone = true;
            return res;
        });

        // 启动 SLE (V3 允许稍微等待 SLC 开口，也可以完全并联)
        const sleOutput = await this.runSLE(messages, text, " ", fullSoul, onChunk, callId, signal, notifier);

        const slcFinalOutput = await slcPromise;
        
        // 记录对话历史
        const fullAssistantReply = (slcFinalOutput + sleOutput).trim();
        if (fullAssistantReply) {
            await this.shadow.logDialogue(callId, 'assistant', fullAssistantReply);
        }
        
        onChunk({ content: '', isFinal: true, type: 'text' });
        console.log(`[V3 Perf][${callId}] Process Finished in ${(performance.now() - totalStart).toFixed(2)}ms`);
    }
}
