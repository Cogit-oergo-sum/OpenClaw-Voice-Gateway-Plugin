import OpenAI from 'openai';
import { ShadowManager } from './shadow-manager';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';
import * as fs from 'fs';
import * as path from 'path';

// ============ [重构 V2.0] 无锁队列实现 ============
class LockFreeQueue<T> {
    private items: T[] = [];
    private readonly maxSize: number;
    
    constructor(maxSize: number = 1000) {
        this.maxSize = maxSize;
    }
    
    push(item: T): boolean {
        if (this.items.length >= this.maxSize) return false;
        this.items.push(item);
        return true;
    }
    
    pop(): T | undefined {
        return this.items.shift();
    }
    
    clear(): void {
        this.items = [];
    }
    
    get length(): number {
        return this.items.length;
    }
}

// ============ [重构 V2.0] 连接池 ============
class OpenAIPool {
    private clients: OpenAI[] = [];
    private readonly poolSize: number;
    private readonly config: any;
    
    constructor(config: any, poolSize: number = 3) {
        this.config = config;
        this.poolSize = poolSize;
        this.init();
    }
    
    private init() {
        for (let i = 0; i < this.poolSize; i++) {
            this.clients.push(new OpenAI({
                apiKey: this.config.apiKey,
                baseURL: this.config.baseURL
            }));
        }
        console.log(`[OpenAIPool] Initialized ${this.poolSize} connections`);
    }
    
    acquire(): OpenAI {
        return this.clients[Math.floor(Math.random() * this.clients.length)];
    }
    
    async warmup() {
        const promises = this.clients.map(async (client, i) => {
            try {
                await client.chat.completions.create({
                    model: 'qwen-turbo',
                    messages: [{ role: 'user', content: '.' }],
                    max_tokens: 1
                });
                console.log(`[OpenAIPool] Connection ${i} warmed`);
            } catch (e) {}
        });
        await Promise.all(promises);
    }
}

// ============ [重构 V2.0] 熔断器 ============
class CircuitBreaker {
    private failures = 0;
    private lastFailureTime = 0;
    private state: 'closed' | 'open' | 'half-open' = 'closed';
    private readonly threshold: number;
    private readonly timeout: number;
    
    constructor(threshold: number = 5, timeout: number = 30000) {
        this.threshold = threshold;
        this.timeout = timeout;
    }
    
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        if (this.state === 'open') {
            if (Date.now() - this.lastFailureTime > this.timeout) {
                this.state = 'half-open';
            } else {
                throw new Error('Circuit breaker is OPEN');
            }
        }
        
        try {
            const result = await fn();
            if (this.state === 'half-open') {
                this.state = 'closed';
                this.failures = 0;
            }
            return result;
        } catch (e) {
            this.failures++;
            this.lastFailureTime = Date.now();
            if (this.failures >= this.threshold) {
                this.state = 'open';
            }
            throw e;
        }
    }
    
    getState(): string {
        return this.state;
    }
}

// ============ [重构 V2.0] 背压控制器 ============
class BackpressureController {
    private readonly maxConcurrent: number;
    private current = 0;
    private queue: Array<{ resolve: () => void; reject: (e: Error) => void }> = [];
    
    constructor(maxConcurrent: number = 10) {
        this.maxConcurrent = maxConcurrent;
    }
    
    async acquire(): Promise<void> {
        if (this.current < this.maxConcurrent) {
            this.current++;
            return;
        }
        
        return new Promise((resolve, reject) => {
            this.queue.push({ resolve, reject });
        });
    }
    
    release(): void {
        if (this.queue.length > 0) {
            const next = this.queue.shift()!;
            next.resolve();
        } else {
            this.current--;
        }
    }
    
    getPending(): number {
        return this.queue.length;
    }
}

export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge';
}

/**
 * FastAgent 核心类 V2.0 - 并发稳定性重构版
 * 
 * 新增特性:
 * - 无锁队列缓冲
 * - 连接池复用
 * - 熔断器保护
 * - 背压控制
 * - 异步 I/O 分离
 */
export class FastAgent {
    private pool: OpenAIPool;
    private shadow: ShadowManager;
    private circuitBreaker: CircuitBreaker;
    private backpressure: BackpressureController;
    private responseQueue: LockFreeQueue<FastAgentResponse>;
    private keepAliveTimer: NodeJS.Timeout | null = null;
    private isDestroyed = false;

    constructor(private config: PluginConfig, private workspaceRoot: string) {
        // [重构 V2.0] 连接池初始化
        this.pool = new OpenAIPool({
            apiKey: config.llm.apiKey,
            baseURL: config.llm.baseUrl
        }, 3);
        
        this.shadow = new ShadowManager(workspaceRoot);
        
        // [重构 V2.0] 熔断器初始化
        this.circuitBreaker = new CircuitBreaker(5, 30000);
        
        // [重构 V2.0] 背压控制器初始化
        this.backpressure = new BackpressureController(10);
        
        // [重构 V2.0] 无锁队列初始化
        this.responseQueue = new LockFreeQueue(1000);
        
        this.startKeepAlive();
    }

    private startKeepAlive() {
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.keepAliveTimer = setInterval(async () => {
            if (this.isDestroyed) return;
            try {
                await this.pool.warmup();
                console.log('[FastAgent] 💓 Connection Pool Warmed.');
            } catch (e) {}
        }, 50000); 
    }

    async process(
        messages: any[], 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string) => Promise<void>
    ) {
        const totalStart = performance.now();
        const callId = getCurrentCallId() || 'anonymous';
        
        // [重构 V2.0] 背压控制 - 限制并发请求
        await this.backpressure.acquire();
        
        try {
            const lastUserMessage = [...messages].reverse().find(m => m.role === 'user');
            const text = lastUserMessage?.content || "";
            
            let deliveredText = ""; 
            let isToolCallDetected = false;
            let streamHandoff = false;
            let slcBuffer: string[] = [];
            let slcReleased = false;

            // [重构 V2.0] 使用队列缓冲响应
            const queueToChunk = (resp: FastAgentResponse) => {
                if (this.responseQueue.push(resp)) {
                    onChunk(resp);
                } else {
                    console.warn('[FastAgent] Response queue full, dropping chunk');
                }
            };

            // 发送静默占位
            queueToChunk({ content: " ", type: 'bridge', isFinal: false });

            // --- 0.8s  watchdog ---
            const watchdogTimer = setTimeout(() => {
                if (!streamHandoff && deliveredText === "") {
                    const fillers = [
                        "先生...", "我在呢...", "明白您的意思...", "这样啊...", "你说，我在听...", 
                        "倒是有些意思...", "懂了先生...", "听着呢..."
                    ];
                    const picked = fillers[Math.floor(Math.random() * fillers.length)];
                    console.log(`[FastAgent] Watchdog triggered (0.8s). Injecting Filler: ${picked}`);
                    queueToChunk({ content: picked, type: 'bridge', isFinal: false });
                    deliveredText = picked; 
                }
            }, 800);

            // SLC (本能) 快速启动 - [重构 V2.0] 异步 I/O 分离
            const slcPromise = (async () => {
                try {
                    const hasStress = /累 | 忙|急 | 压力 | 烦/.test(text);
                    const emotionHint = hasStress ? "用户听起来压力很大，请用更温存、体谅的语气。" : "优雅、敏捷、管家风范。";

                    const client = this.pool.acquire();
                    const stream = await this.circuitBreaker.execute(() => 
                        client.chat.completions.create({
                            model: this.config.fastAgent?.slcModel || 'qwen-turbo',
                            messages: [
                                { role: 'system', content: `你是一个智能管家 Jarvis。给出一个极短（1-3 字）且感性、自然、不重复的口语回应。${emotionHint}。严禁说：[好的，明白，已经，处理中，正在，任务，系统]。` },
                                { role: 'user', content: text }
                            ] as any,
                            stream: true,
                            max_tokens: 10,
                            temperature: 0.95 
                        })
                    );

                    for await (const chunk of stream) {
                        if (streamHandoff) break;
                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            if (slcReleased) queueToChunk({ content, isFinal: false, type: 'filler' });
                            else slcBuffer.push(content);
                            deliveredText += content;
                        }
                    }
                } catch (e) {
                    console.warn(`[SLC Error] ${e}`);
                }
            })();

            // [重构 V2.0] 异步 I/O 分离 - 影子状态恢复不阻塞 SLC
            const shadowStart = performance.now();
            const shadowPromise = (async () => {
                await Promise.all([
                    this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } }),
                    this.shadow.recover(callId)
                ]);
                const soul = await this.shadow.getContextPrompts();
                console.log(`[Perf][${callId}] Shadow recovery took ${(performance.now() - shadowStart).toFixed(2)}ms`);
                await this.shadow.logDialogue(callId, 'user', text);
                return soul;
            })();

            // --- [接力赛] 等待并启动 SLE ---
            const slePromise = (async () => {
                const fullSoul = await shadowPromise;
                
                const coldWindow = 200;
                const checkInterval = 20;
                let elapsed = 0;
                while (elapsed < coldWindow && !streamHandoff) {
                    await new Promise(r => setTimeout(r, checkInterval));
                    elapsed += checkInterval;
                }

                if (!streamHandoff) {
                    slcReleased = true;
                    if (slcBuffer.length > 0) {
                        queueToChunk({ content: slcBuffer.join(''), isFinal: false, type: 'filler' });
                        slcBuffer = [];
                    }
                }

                const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
                
                try {
                    const sleMessages = [
                        { role: 'system', content: `${fullSoul}\n\n# 核心交互准则\n4. **拒绝复读与报备**：禁止复述已知参数。\n5. **高效表达**：急躁场景下字数压缩 50%。` },
                        ...messages.slice(0, -1),
                        { role: 'user', content: text },
                        { role: 'system', content: `[接力接管] 前序 SLC 节点已快速响应 "${deliveredText}"。请你以此为 Prefill，继续完成剩下的表达或逻辑决策。` },
                        { role: 'assistant', content: deliveredText } 
                    ];

                    const sleLlmStart = performance.now();
                    const client = this.pool.acquire();
                    const stream = await this.circuitBreaker.execute(() =>
                        client.chat.completions.create({
                            model: sleModel,
                            messages: sleMessages as any,
                            stream: true,
                            tools: [{
                                type: 'function',
                                function: {
                                    name: 'delegate_openclaw',
                                    description: '委派任务给主控助理。',
                                    parameters: {
                                        type: 'object',
                                        properties: { intent: { type: 'string', description: '清晰的委派意图' } }
                                    }
                                }
                            }]
                        })
                    );
                    console.log(`[Perf][${callId}] SLE stream start-up took ${(performance.now() - sleLlmStart).toFixed(2)}ms`);

                    let toolCalls: any[] = [];
                    let isFilteringMode = false;
                    for await (const chunk of stream) {
                        const delta = chunk.choices[0]?.delta;
                        
                        if (delta?.content || delta?.tool_calls) {
                            streamHandoff = true;
                        }

                        if (delta?.tool_calls) {
                            for (const toolCall of delta.tool_calls) {
                                if (!toolCalls[toolCall.index]) {
                                    toolCalls[toolCall.index] = { ...toolCall };
                                } else {
                                    if (toolCall.function?.arguments) {
                                        toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                                    }
                                }
                            }
                            if (!isToolCallDetected) {
                                isToolCallDetected = true;
                            }
                        } else if (delta?.content) {
                            // 🚀 [V2.0.5] 流式过滤器：拦截分片下发的潜意识标签
                            const chars = delta.content.split('');
                            let filteredDelta = "";
                            for (const char of chars) {
                                if (char === '(' || char === '[') {
                                    isFilteringMode = true;
                                    continue;
                                }
                                if (isFilteringMode) {
                                    if (char === ')' || char === ']') isFilteringMode = false;
                                    continue;
                                }
                                filteredDelta += char;
                            }
                            
                            if (filteredDelta) {
                                queueToChunk({ content: filteredDelta, isFinal: false, type: 'text' });
                                deliveredText += filteredDelta;
                            }
                        }
                    }
                    clearTimeout(watchdogTimer);

                    // --- 处理工具调用 ---
                    if (isToolCallDetected) {
                        const finalToolCalls = toolCalls.filter(tc => tc !== undefined);
                        const toolResults = await Promise.all(finalToolCalls.map(async (tc) => {
                            const args = JSON.parse(tc.function.arguments || '{}');
                            console.log(`[FastAgent] Executing tool: ${tc.function.name}`, args);
                            
                            let result = "";
                            if (tc.function.name === 'delegate_openclaw') {
                                const contextEnv = await this.shadow.getRecentDialogueContext(3);
                                const intent = contextEnv + (args.intent || "");
                                console.log(`[FastAgent] Delegating to Main Soul (CLI) with Context: ${intent}`);
                                
                                try {
                                    const { exec } = require('child_process');
                                    const { promisify } = require('util');
                                    const execAsync = promisify(exec);
                                    
                                    const cliPromise = execAsync(`openclaw agent --agent main --message "${intent.replace(/"/g, '\\"')}" --json`, {
                                        env: { ...process.env, OPENCLAW_PROFILE: '/app/workspace' },
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
                                                   || data.content
                                                   || data.message
                                                   || (data.messages && data.messages.length > 0 ? data.messages[data.messages.length - 1]?.content : null)
                                                   || JSON.stringify(data);
                                        } else {
                                            result = stdout || "交给我，办妥了。";
                                        }
                                    } catch (err: any) {
                                        if (err.message === 'TIMEOUT_5S') {
                                            console.log(`[FastAgent] Task taking too long, backgrounding: ${intent}`);
                                            result = "[BACKGROUND_MODE] 这件事稍微有点复杂，我交托主脑去办了。搞定之后我会立刻告诉你，你先忙别的。";
                                            
                                            cliPromise.then(async ({ stdout }: any) => {
                                                console.log(`[FastAgent] Background Task Finished: ${intent}`);
                                                
                                                const jsonMatch = stdout.match(/\{[\s\S]*\}/);
                                                let finalRes = stdout;
                                                if (jsonMatch) {
                                                    const data = JSON.parse(jsonMatch[0]);
                                                    finalRes = (data.result?.payloads && data.result.payloads[0]?.text)
                                                           || (data.payloads && data.payloads[0]?.text)
                                                           || data.content || data.message || finalRes;
                                                }
                                                                                                // 🚀 [V2.0.5] 激进抹除标签，防止技术噪音污染通知
                                                 const cleanIntent = intent.replace(/[\(\[].*?[\)\]]/g, '').replace(/[\(\[].*$/g, '').trim();
                                                 const cleanRes = finalRes.replace(/[\(\[].*?[\)\]]/g, '').replace(/[\(\[].*$/g, '').trim();
                                                 const notifyText = `刚才我把那个"${cleanIntent.substring(0, 10)}..."的事情处理好了，结果是：${cleanRes}`;
                                                 await this.shadow.logDialogue(callId, 'assistant', notifyText);
                                                
                                                if (notifier) {
                                                    await notifier(notifyText);
                                                }
                                            }).catch((e: any) => {
                                                console.error(`[FastAgent] Background Task Error: ${e.message}`);
                                            });
                                        } else {
                                            throw err;
                                        }
                                    }
                                    console.log(`[FastAgent] Tool Result (Extracted): ${result.substring(0, 50)}...`);
                                } catch (e: any) {
                                    console.error(`[FastAgent] CLI Delegation Error: ${e.message}`);
                                    result = `[MainSoul CLI Error] 抱歉，刚才委派那边出了点岔子：${e.message}`;
                                }
                            }
                            
                            return {
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: result
                            };
                        }));

                        const isClarification = toolResults.some(r => 
                            r.content.includes('?') || 
                            r.content.includes('请问') || 
                            r.content.includes('确认')
                        );

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
                                    ? `[后台转场] 大脑接管了这件事，目前在跑。你跟用户说声"明白，交给我了，弄好了叫你"之类的。别瞎编数据。`
                                    : (isClarification 
                                        ? `[反问辅助] 刚才主控多问了一句。你原封不动地把问题抛给用户，语气自然点。`
                                        : `[汇报] 结果回来了。你用最简单的口吻告诉用户。`)
                            }
                        ];

                        const followUpStream = await this.circuitBreaker.execute(() =>
                            this.pool.acquire().chat.completions.create({
                                model: sleModel,
                                messages: followUpMessages as any,
                                stream: true
                            })
                        );

                        let isFollowUpFiltering = false;
                        for await (const chunk of followUpStream) {
                            const content = chunk.choices[0]?.delta?.content;
                            if (content) {
                                // 🚀 [V2.0.5] 追随流过滤器
                                const chars = content.split('');
                                let filteredContent = "";
                                for (const char of chars) {
                                    if (char === '(' || char === '[') {
                                        isFollowUpFiltering = true;
                                        continue;
                                    }
                                    if (isFollowUpFiltering) {
                                        if (char === ')' || char === ']') isFollowUpFiltering = false;
                                        continue;
                                    }
                                    filteredContent += char;
                                }

                                if (filteredContent) {
                                    queueToChunk({ content: filteredContent, isFinal: false, type: 'text' });
                                    deliveredText += filteredContent;
                                }
                            }
                        }
                    }
                } catch (e: any) {
                    console.error("[SLE Error]", e.message);
                    queueToChunk({ content: `\n[Jarvis 提示] 出了个小状况：${e.message}`, isFinal: false, type: 'text' });
                }
            })();
            
            await Promise.all([slcPromise, slePromise]);
            
            if (deliveredText.trim()) {
                await this.shadow.logDialogue(callId, 'assistant', deliveredText);
            }

            queueToChunk({ content: '', isFinal: true, type: 'text' });
            console.log(`[Perf][${callId}] Total Process Finished: ${(performance.now() - totalStart).toFixed(2)}ms`);
            
        } finally {
            // [重构 V2.0] 释放背压控制
            this.backpressure.release();
        }
    }

    destroy() {
        this.isDestroyed = true;
        if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
        this.responseQueue.clear();
        console.log('[FastAgent] Destroyed, resources released');
    }
    
    // [重构 V2.0] 监控方法
    getMetrics() {
        return {
            circuitBreakerState: this.circuitBreaker.getState(),
            pendingRequests: this.backpressure.getPending(),
            queueLength: this.responseQueue.length
        };
    }
}
