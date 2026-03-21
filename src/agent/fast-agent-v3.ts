import { ShadowManager } from './shadow-manager';
import { DialogueMemory } from './dialogue-memory';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';
import { FastAgentResponse, IFastAgent, CanvasState } from './types';
import { CanvasManager } from './canvas-manager';
import { DelegateExecutor } from './executor';
import { TextCleaner } from '../utils/text-cleaner';
import { WatchdogService } from './watchdog';
import { SLCEngine } from './slc';
import { SLEEngine } from './sle';
import { IntentRouter } from './intent-router';
import { ResultSummarizer } from './result-summarizer';
import { PromptAssembler } from './prompt-assembler';
import { ToolResultHandler } from './tool-result-handler';
import * as path from 'path';

/**
 * [V3.4.0] FastAgentV3: 终极 Facade 调度中枢
 * 采用原子化解耦架构，仅负责核心流程编排。
 */
export class FastAgentV3 implements IFastAgent {
    private shadow: ShadowManager;
    private dialogueMemory: DialogueMemory;
    private canvasManager: CanvasManager;
    private executor: DelegateExecutor;
    private watchdog: WatchdogService;
    private slc: SLCEngine;
    private sle: SLEEngine;
    private intentRouter: IntentRouter;
    private resultSummarizer: ResultSummarizer;
    private promptAssembler: PromptAssembler;
    
    private compactPersona: string = "你是 Jarvis。用户是 先生。";
    private instanceId: string = Math.random().toString(36).substring(7);
    private processedSessions: Set<string> = new Set();
    
    constructor(private config: PluginConfig, private workspaceRoot: string) {
        this.dialogueMemory = new DialogueMemory(workspaceRoot);
        this.shadow = new ShadowManager(workspaceRoot);
        this.promptAssembler = new PromptAssembler(workspaceRoot, this.dialogueMemory);
        this.canvasManager = new CanvasManager(workspaceRoot);
        this.executor = new DelegateExecutor(workspaceRoot);
        this.watchdog = new WatchdogService(this.canvasManager, this.instanceId, 500);
        this.slc = new SLCEngine(config, this.promptAssembler);
        this.resultSummarizer = new ResultSummarizer(config);
        const toolResultHandler = new ToolResultHandler(this.executor, this.resultSummarizer);
        this.sle = new SLEEngine(config, this.resultSummarizer, toolResultHandler);
        this.intentRouter = new IntentRouter(config);

        this.startWatchdog(); 
        this.refreshCompactPersona(); 
        this.slc.warmUp().catch(() => {});
        
        console.log(`[FastAgentV3][V3.3 Refactor] Initialized for workspace: ${this.workspaceRoot}`);
    }

    private async refreshCompactPersona() {
        try {
            // 1. 快速回滚一份基础人设 (Regex Fallback)
            this.compactPersona = await this.promptAssembler.getCompactPersona();

            // 2. [V3.3.0] 委派 ResultSummarizer 基于全量 Raw 信息总结核心摘要
            const callId = getCurrentCallId() || 'global';
            const state = this.shadow.getOrCreateState(callId);
            const fullContext = await this.promptAssembler.getContextPrompts(callId, state, true);
            const highResPersona = await this.resultSummarizer.summarizePersona(fullContext);

            if (highResPersona && highResPersona.length > 5) {
                this.compactPersona = highResPersona;
                // [V3.3.0] 持久化到影子状态，确保 SLC 在 assemblePrompt 时能取到最新的高精度摘要
                await this.shadow.updateState({ metadata: { compact_persona: highResPersona } });
                
                // 🚀 为方便用户验证，同步记录到画布日志
                const callId = getCurrentCallId() || 'global';
                await this.canvasManager.logCanvasEvent(callId, 'PERSONA_REFRESHED', { compact_persona: highResPersona });
                
                console.log(`[FastAgentV3] Persona summarized by SLE and saved: ${this.compactPersona}`);
            }
        } catch (e) {
            console.error(`[FastAgentV3] Failed to summarize high-res persona:`, e);
        }
    }

    private async logCanvasEvent(callId: string, event: string, detail: any) {
        await this.canvasManager.logCanvasEvent(callId, event, detail);
    }

    destroy() {
        console.log(`[FastAgentV3] Destroying Facade...`);
        this.watchdog.stop();
        this.processedSessions.clear();
    }

    private async handleWatchdogTrigger(
        callId: string,
        triggerType: '__INTERNAL_TRIGGER__' | '__IDLE_TRIGGER__',
        chunkTypes: string[],
        prefix: string
    ): Promise<void> {
        const notifier = this.watchdog.getNotifier(callId);
        if (!notifier) return;

        console.log(`[Watchdog][${this.instanceId}] 📣 ${prefix} for ${callId}`);

        let fullOutput = "";
        await this.process(
            triggerType,
            (chunk) => {
                if (chunk.content && chunkTypes.includes(chunk.type)) {
                    fullOutput += chunk.content;
                }
            },
            async () => {},
            callId
        );

        const trace = await this.getCurrentTrace(callId);
        if (fullOutput.trim()) {
            await notifier(`${prefix}${fullOutput.trim()}`, trace);
        }
    }

    private startWatchdog() {
        this.watchdog.on('trigger', async ({ callId, status }) => {
            status.is_delivered = true;
            await this.logCanvasEvent(callId, 'WATCHDOG_INTERNAL_TRIGGER', { status });
            try {
                await this.handleWatchdogTrigger(callId, '__INTERNAL_TRIGGER__', ['internal', 'chat'], '[INTERNAL]');
                await this.logCanvasEvent(callId, 'WATCHDOG_DELIVERED', { callId });
            } catch (e) {
                console.error(`[Watchdog] Delivery Failed:`, e);
                status.is_delivered = false;
                // 🚀 重要：同步记录失败状态，确保磁盘快照更新为未投递，以便下次心跳重试
                await this.logCanvasEvent(callId, 'WATCHDOG_DELIVERY_FAILED', { error: (e as any).message });
            }
        });

        this.watchdog.on('idle_trigger', async ({ callId }) => {
            try {
                await this.handleWatchdogTrigger(callId, '__IDLE_TRIGGER__', ['idle', 'chat'], '[IDLE]');
            } catch (e) {
                console.error(`[Watchdog] Idle greeting failed:`, e);
            }
        });

        this.watchdog.start();
    }

    private async getCurrentTrace(callId: string): Promise<string[] | undefined> {
        const events = await this.canvasManager.getCanvasEvents(callId);
        const traceEvent = [...events].reverse().find(e => e.event === 'TRACE');
        return traceEvent?.detail?.trace;
    }

    /**
     * [V3.2 Facade] 核心编排逻辑
     */
    async process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string, trace?: string[]) => Promise<void>,
        callIdOverride?: string
    ) {
        const trace: string[] = [];
        const totalStart = performance.now();
        const callId = callIdOverride || getCurrentCallId() || 'anonymous';
        
        const isNewSession = !this.processedSessions.has(callId);
        if (isNewSession) {
            this.processedSessions.add(callId);
            // 🚀 [V3.3.0] Session Start 初始化 (后台执行，不阻塞首字返回)
            this.intentRouter.initializeSession(callId, this.canvasManager).catch(e => {});
            this.refreshCompactPersona().catch(e => {});
        }

        if (notifier) this.watchdog.registerNotifier(callId, notifier);

        const signal = { interrupted: false, slcDone: false };
        let slcOutputResult = "";
        let sleOutputResult = "";
        const canvas = this.canvasManager.getCanvas(callId);
        
        // 🚀 [V3.3.1] 每次请求都更新画布时间，确保回复（含心跳触发）数据新鲜
        canvas.env.time = new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        
        // 🚀 [V3.4.1] 标记繁忙状态，防止心跳触发打断当前正在进行的互动
        canvas.context.is_busy = true;
        
        try {
            if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__') {
                canvas.context.last_interaction_time = Date.now();
                onChunk({ content: " ", type: 'bridge', isFinal: false });
            }

            // 🚀 [V3.3.9] SSOT 内存恢复：从影子管理器获取真正的对话历史
            const managedMessages = await this.dialogueMemory.getHistoryMessages(callId, 10);
            
            // 包装 onChunk，同步更新活跃时间（防止流式响应期间心跳超时）
            const wrappedOnChunk = (chunk: FastAgentResponse) => {
                canvas.context.last_interaction_time = Date.now();
                onChunk(chunk);
            };

            // 1. 准备 SLE 判定上下文 (Intent Detection)
            const fullSoul = await (async () => {
                await this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } });
                await this.shadow.recover(callId);
                const state = this.shadow.getScopedState();
                const soul = await this.promptAssembler.assemblePrompt('SLE', callId, state, isNewSession);
                
                if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__') {
                    await this.dialogueMemory.logDialogue(callId, 'user', text);
                    // 🚀 将当前消息也加入内存上下文
                    managedMessages.push({ role: 'user', content: text });
                }
                
                return soul + `\n[核心画布实时状态 (Canvas State)]\n环境: ${JSON.stringify(canvas.env)}\n任务状态: ${JSON.stringify(canvas.task_status)}\n最近播报锚点 (Anchor): ${canvas.context.last_spoken_fragment || '无'}\n`;
            })();

            // 2. 同步判定意图 (Routing Decision)
            let needsTool = false;
            let toolIntent = "";
            
            if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__') {
                trace.push('SLE (意图分析)');
                const detection = await this.intentRouter.detectIntent(text, managedMessages, fullSoul);
                needsTool = detection.needsTool;
                toolIntent = detection.intent || "";
                console.log(`[FastAgentV3][Router] needsTool: ${needsTool}, intent: ${toolIntent}`);
            }

            // 3. 执行分流
            if (text === '__INTERNAL_TRIGGER__' || text === '__IDLE_TRIGGER__') {
                // A. 画布/心跳触发 -> 直接 SLC 播报
                const step = text === '__IDLE_TRIGGER__' ? 'SLC (心跳)' : 'SLC (任务播报)';
                trace.push(step);
                slcOutputResult = await this.slc.run(text, canvas.context.last_spoken_fragment, canvas.task_status.summary, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
                signal.slcDone = true;
            } else if (needsTool) {
                // B. 任务模式 (Tool Mode) -> SLC 垫词 + SLE 并行执行
                console.log(`[FastAgentV3] Entering TOOL MODE...`);
                
                const slcPromise = (async () => {
                    trace.push('SLC (垫词)');
                    return await this.slc.run(
                        '__TOOL_WAITING_TRIGGER__', 
                        canvas.context.last_spoken_fragment, 
                        toolIntent, 
                        this.shadow, 
                        wrappedOnChunk, 
                        signal,
                        managedMessages, // 🚀 [V3.3.5] 传递对话上下文
                        isNewSession
                    );
                })();
                
                const slePromise = (async () => {
                    trace.push('SLE (判断具体使用的工具)');
                    return await this.sle.run(
                        managedMessages, 
                        text, 
                        "", 
                        fullSoul, 
                        callId, 
                        this.canvasManager, 
                        (chunk) => {}, 
                        signal,
                        toolIntent
                    );
                })();

                slcOutputResult = await slcPromise;
                signal.slcDone = true;
                slePromise.catch(e => console.error(e));
            } else {
                // C. 聊天模式 (Chat Mode) -> 仅 SLC 直接回复
                console.log(`[FastAgentV3] Entering CHAT MODE...`);
                trace.push('SLC (直接回复)');
                slcOutputResult = await this.slc.run(text, canvas.context.last_spoken_fragment, "", this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
                signal.slcDone = true;
                
                // 为了保持 SLE 对话记忆，仍异步运行 SLE 但不推流
                this.sle.run(managedMessages, text, slcOutputResult, fullSoul, callId, this.canvasManager, () => {}, signal).catch(e => {});
            }

            const slcFinalOutput = slcOutputResult;
            if (slcFinalOutput && slcFinalOutput.length > 5 && slcFinalOutput.length < 50) {
                canvas.context.last_spoken_fragment = slcFinalOutput;
            }
            
            // 4. 统一存储对话记录 (脱敏)
            // 关键：仅将最终用于“说话”的内容存入对话历史。
            // 在 Tool Mode 下，SLE 的输出包含内部工具执行备注，不应混入 Assistant 回复历史。
            // 只有 Chat Mode 或 Internal Trigger 产生的正式对白才存入消息。
            const assistantVoiceReply = slcFinalOutput.trim();
            
            if (assistantVoiceReply) {
                const cleanReply = TextCleaner.decant(assistantVoiceReply);
                await this.dialogueMemory.logDialogue(callId, 'assistant', cleanReply);
            }
            
            await this.logCanvasEvent(callId, 'TRACE', { trace });
            wrappedOnChunk({ content: '', isFinal: true, type: 'filler', trace });
            
            // 🚀 [V3.3.10] 消费性清理 (Clear on Delivery)
            // 一旦确认摘要已投递（is_delivered === true），清理 Canvas 摘要区以防止上下文污染
            if (canvas.task_status.is_delivered && canvas.task_status.summary) {
                console.log(`[FastAgentV3][${callId}] 🧹 Consuming delivered summary to prevent context pollution.`);
                canvas.task_status.summary = ""; 
                canvas.task_status.extracted_data = "";
                await this.logCanvasEvent(callId, 'CANVAS_CONSUMED', { reason: 'pollution_prevention' });
            }
            
            // 🚀 [V3.3.8] 完成一次回复后（含触发），显式更新最后交互时间，防止冷场重叠
            canvas.context.last_interaction_time = Date.now();
        } finally {
            canvas.context.is_busy = false; // 🚀 解除繁忙标记
        }
        
        console.log(`[V3 Perf][${callId}] Process Finished in ${(performance.now() - totalStart).toFixed(2)}ms, trace: ${trace.join(' -> ')}`);
    }
}
