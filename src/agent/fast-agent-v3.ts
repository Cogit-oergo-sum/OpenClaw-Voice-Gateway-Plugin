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
    private processedSessions: Set<string> = new Set();
    
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
        console.log(`[Watchdog] 🛡️ Started. Scanning interval: 10000ms`);
        
        this.scanTimer = setInterval(async () => {
             const details = Array.from(this.canvases.entries()).map(([id, c]) => 
                 `${id}(${c.task_status.status},is_del=${c.task_status.is_delivered},notif=${!!this.notifiers.get(id)})`
             ).join(', ');
             console.log(`[Watchdog][${this.instanceId}] 💓 Heartbeat: ${this.canvases.size} canvases: [${details || 'none'}]`);

             // 🚀 [V3.3.6] 磁盘同步，感知外部系统（如 openclaw core）的状态变更
             await this.syncCanvasesFromDisk();

            for (const [callId, canvas] of this.canvases.entries()) {
                const status = canvas.task_status;
                
                // 仅扫描 READY 且未播报的单元
                if (status.status === 'READY' && !status.is_delivered) {
                    if (status.importance_score < 0.7) continue;

                    // 🚀 [V3.3.0] 关键修复：立即标记投递中，防止并发心跳重复触发
                    status.is_delivered = true; 

                    const notifier = this.notifiers.get(callId);
                    if (notifier) {
                        console.log(`[Watchdog][${this.instanceId}] 📣 INTERNAL_TRIGGER for ${callId}: status summary is "${status.summary.substring(0, 30)}..."`);
                        await this.logCanvasEvent(callId, 'WATCHDOG_INTERNAL_TRIGGER', { status });
                        
                        try {
                            const notificationBuffer = status.summary;
                            
                            // 🚀 [V3.2.0] 直接交付给 SLC 处理情绪表达
                             await this.process(
                                [{ role: 'user', content: '__INTERNAL_TRIGGER__' }],
                                (chunk) => {
                                    // Watchdog 通知不需要向 SLC 发送流（因为它直接推送到 notifier）
                                    // 仅作为触发器注入上下文
                                },
                                async (cleanMsg) => {
                                  await notifier(cleanMsg);
                                }
                            );
                            
                            console.log(`[Watchdog][${this.instanceId}] ✅ Delivered via SLC/SLE loop to ${callId}`);
                            await this.logCanvasEvent(callId, 'WATCHDOG_DELIVERED', { callId });
                        } catch (e) {
                            console.error(`[Watchdog][${this.instanceId}] ❌ Delivery Failed for ${callId}:`, e);
                            status.is_delivered = false; // 允许下次重试
                        }
                    } else {
                        status.is_delivered = false; // 等待 notifier 就位后再触发
                    }
                }
            }
        }, 10000);
    }


    /**
     * [V3.3.6] 磁盘同步：从审计日志中恢复最新的画布状态
     * 解决外部系统（CLI, Timers）更新状态后，本进程内存不感知的问题
     */
    private async syncCanvasesFromDisk() {
        try {
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            if (!fs.existsSync(logPath)) return;
            
            const content = await fs.promises.readFile(logPath, 'utf8');
            const lines = content.trim().split('\n').slice(-100); // 仅扫描最近 100 条变动以平衡性能
            
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.callId && entry.state?.task_status && this.canvases.has(entry.callId)) {
                        const canvas = this.canvases.get(entry.callId)!;
                        if (entry.state.task_status.version >= canvas.task_status.version) {
                           // 🚀 防止回滚：如果内存中已投递，不被磁盘的老状态覆盖为未投递
                           const wasDelivered = canvas.task_status.is_delivered;
                           if (canvas.task_status.status !== entry.state.task_status.status) {
                               console.log(`[Watchdog] 🔄 Session ${entry.callId} state synced: ${canvas.task_status.status} -> ${entry.state.task_status.status}`);
                           }
                           Object.assign(canvas.task_status, entry.state.task_status);
                           if (wasDelivered) canvas.task_status.is_delivered = true;
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error('[Watchdog] Disk sync failed:', e);
        }
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

    /**
     * [V3.3.7] 终极噪音净化：在任何播报前清洗所有技术关键词和内心 OS
     */
    private cleanText(text: string): string {
        return text
            .replace(/\(已.*?闭环\)/g, '')
            .replace(/\(已.*?同步.*?\)/g, '')
            .replace(/\[调用.*?\]/g, '')
            .replace(/\[\{.*?\}\]/g, '')
            .replace(/HEARTBEAT_OK/g, '')
            .replace(/session_start/g, '')
            .trim();
    }

    private async asButler(result: string, intent: string): Promise<string> {
        const prompt = `你是一个优雅的英式管家 Jarvis。
用户意图: "${intent}"
需要转化的内容: "${result}"

任务：将“需要转化的内容”转化为一段极其自然、优雅、温润的管家式口语。
【规则】:
1. 绝对严禁复读任务、系统、JSON、状态、处理、闭环、同步、Memory、日志、Heartbeat 等技术词汇。
2. 绝对严禁复读或提及任何括号内的备注，如 "(已闭环)", "(已同步...)", "HEARTBEAT_OK"。
3. 如果被转化的内容全是技术噪音，请直接说：“先生，那件事已经办好了。”
4. 极其自然口语化，如同在桌旁低语汇报，严禁超过 25 字。`;

        try {
            const resp = await this.openai.chat.completions.create({
                model: this.config.fastAgent?.sleModel || this.config.llm.model,
                messages: [{ role: 'system', content: prompt }] as any,
                temperature: 0.7,
                max_tokens: 150
            });
            let reply = resp.choices[0]?.message?.content || "先生，办妥了。";
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

# 虚拟触发指令 (Internal Trigger)
- 如果当前输入是 "__INTERNAL_TRIGGER__"，表示后台任务刚刚出结果了。
- 你必须查阅画布状态：
    - 如果画布中的 \`summary\` 包含 "错误"、"failed"、"missing" 等失败信息，你必须如实告知先生任务遇到了困难，并简要说明原因。
    - 严禁在任务失败时说“已闭环”或“已办妥”。
- 你必须以 Jarvis 的得体语气汇报成果，不要包含任何技术标签。

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
            let isFilteringMode = false;
            
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
                            isFilteringMode = true;
                            continue;
                        }
                        if (isFilteringMode) {
                            if (char === ')' || char === ']') {
                                isFilteringMode = false;
                            }
                            continue;
                        }
                        sleContentBuffer += char;
                    }
                    
                    if (sleContentBuffer.match(/\[调用|delegate_|\[delegate_|{"intent":|\[\{/)) {
                       sleContentBuffer = ""; 
                       continue;
                    }

                    if (!toolCalls.some(tc => tc !== undefined) && sleContentBuffer.length > 0) {
                        signal.interrupted = true; 
                        const cleanFrag = this.cleanText(sleContentBuffer);
                        if (cleanFrag) {
                          onChunk({ content: cleanFrag, isFinal: false, type: 'text' });
                          sleFullOutput += cleanFrag;
                        }
                        sleContentBuffer = "";
                    }
                }
            }

            // 🚀 [V3.3.4] 全局噪音净化
            if (sleFullOutput.length > 0) {
                 sleFullOutput = sleFullOutput
                    .replace(/\(已.*?闭环\)/g, '')
                    .replace(/\(已.*?同步.*?\)/g, '')
                    .replace(/\[调用.*?\]/g, '')
                    .replace(/\[\{.*?\}\]/g, '')
                    .replace(/HEARTBEAT_OK/g, '')
                    .trim();
            }

            if (sleFullOutput.includes('```json')) {
                try {
                    const jsonStr = sleFullOutput.match(/```json\s*(\{[\s\S]*?\})\s*```/)?.[1];
                    if (jsonStr) {
                        const canvasUpdate = JSON.parse(jsonStr);
                        Object.assign(canvas.task_status, canvasUpdate.task_status);
                    }
                } catch(e) {}
            }

            if (toolCalls.length > 0) {
                const finalToolCalls = toolCalls.filter(tc => tc !== undefined);
                for (const tc of finalToolCalls) {
                    const args = JSON.parse(tc.function.arguments || '{}');
                    const intent = args.intent || text;
                    try {
                        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
                        const command = `openclaw agent --agent main --session-id "${callId}" --message "${intent.replace(/"/g, '\\"')}" --json`;
                        
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
                                
                                // 🚀 [V3.3.5] 关键：实时同步画布状态
                                if (data.task_status) {
                                    Object.assign(canvas.task_status, data.task_status);
                                    this.logCanvasEvent(callId, 'CANVAS_CLI_SYNC', { status: data.task_status.status });
                                }
                            } else {
                                // 🚀 [V3.3.2] 防噪音机制：过滤 HEARTBEAT_OK 等调试信息
                                result = stdout.replace(/HEARTBEAT_OK/g, '').trim(); 
                                if (!result && stderr) {
                                  result = `执行失败: ${stderr.split('\n')[0]}`;
                                } else if (!result) {
                                  result = "已按指令处理妥当。";
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

                                 cliPromise.then(async ({ stdout, stderr }) => {
                                     const out = stdout || (stderr ? `错误: ${stderr}` : "任务完成。");
                                     canvas.task_status.summary = out;
                                     canvas.task_status.status = 'READY';
                                     canvas.task_status.is_delivered = false;
                                     canvas.task_status.importance_score = 1.0; 
                                     this.logCanvasEvent(callId, 'CANVAS_CLI_READY', { summary: out });
                                 }).catch(e => {
                                     console.error(`[V3 Background Error] ${e}`);
                                     canvas.task_status.summary = `任务执行出错: ${e.message}`;
                                     canvas.task_status.status = 'READY';
                                     canvas.task_status.is_delivered = false;
                                     this.logCanvasEvent(callId, 'CANVAS_CLI_ERROR', { error: e.message });
                                 });
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
        notifier?: (text: string) => Promise<void>,
        callIdOverride?: string
    ) {
        const totalStart = performance.now();
        const callId = callIdOverride || getCurrentCallId() || 'anonymous';
        const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
        const text = lastUserMessage?.content || "";
        
        const isNewSession = !this.processedSessions.has(callId);
        if (isNewSession) {
            console.log(`[V3 Inbound] 🚀 New Session Detected for ${callId}: Injecting Global History.`);
            this.processedSessions.add(callId);
        }

        const signal = { interrupted: false, slcDone: false };
        let slcOutput = "";

        if (text !== '__INTERNAL_TRIGGER__') {
            onChunk({ content: " ", type: 'bridge', isFinal: false });
        }

        const fullSoul = await (async () => {
            await this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } });
            await this.shadow.recover(callId);
            const soul = await this.shadow.getContextPrompts(isNewSession);
            this.refreshCompactPersona(); 
            
            if (text !== '__INTERNAL_TRIGGER__') {
                await this.shadow.logDialogue(callId, 'user', text);
            }
            
            const canvas = this.getCanvas(callId);
            const canvasInjection = `
[核心画布实时状态 (Canvas State)]
环境: ${JSON.stringify(canvas.env)}
任务状态: ${JSON.stringify(canvas.task_status)}
最后播报断点: ${canvas.context.last_spoken_fragment || '无'}
`;
            return soul + canvasInjection;
        })();

        const slcPromise = text === '__INTERNAL_TRIGGER__' 
            ? Promise.resolve("") 
            : this.runSLC(text, "", onChunk, signal).then((res: any) => {
                slcOutput = res;
                signal.slcDone = true;
                return res;
            });

        const sleOutput = await this.runSLE(messages, text, " ", fullSoul, onChunk, callId, signal, notifier);
        const slcFinalOutput = await slcPromise;
        
        const fullAssistantReply = (slcFinalOutput + (sleOutput || "")).trim();
        if (fullAssistantReply) {
            await this.shadow.logDialogue(callId, 'assistant', fullAssistantReply);
        }
        
        onChunk({ content: '', isFinal: true, type: 'text' });
        console.log(`[V3 Perf][${callId}] Process Finished in ${(performance.now() - totalStart).toFixed(2)}ms`);
    }
}
