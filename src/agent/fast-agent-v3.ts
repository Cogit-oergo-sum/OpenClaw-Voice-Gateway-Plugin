import { ShadowManager } from './shadow-manager';
import { DialogueMemory } from './dialogue-memory';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';
import { FastAgentResponse, IFastAgent } from './types';
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
import { AgentOrchestrator } from './agent-orchestrator';
import { CallManager } from '../call/call-manager';
import { SkillRegistry } from './skills';

/**
 * [V3.6.0] FastAgentV3: 终极 Facade 调度中枢
 * 通过 AgentOrchestrator 实现原子化解耦流程。
 */
export class FastAgentV3 implements IFastAgent {
    private shadow: ShadowManager;
    private dialogueMemory: DialogueMemory;
    private canvasManager: CanvasManager;
    private watchdog: WatchdogService;
    private slc: SLCEngine;
    private sle: SLEEngine;
    private intentRouter: IntentRouter;
    private resultSummarizer: ResultSummarizer;
    private promptAssembler: PromptAssembler;
    private orchestrator: AgentOrchestrator;
    private executor: DelegateExecutor;
    private registry: SkillRegistry;
    
    private compactPersona: string = "你是 Jarvis。用户是 先生。";
    private instanceId: string = Math.random().toString(36).substring(7);
    private processedSessions: Set<string> = new Set();
    private announcingSessions: Set<string> = new Set();
    private personaInitPromise: Promise<void> | null = null;
    
    constructor(private config: PluginConfig, private workspaceRoot: string, private callManager?: CallManager) {
        this.dialogueMemory = new DialogueMemory(workspaceRoot);
        this.shadow = new ShadowManager(workspaceRoot);
        this.canvasManager = new CanvasManager(workspaceRoot);
        this.promptAssembler = new PromptAssembler(workspaceRoot, this.dialogueMemory, this.canvasManager);
        this.resultSummarizer = new ResultSummarizer(config);
        this.executor = new DelegateExecutor(workspaceRoot); // Assigned to this.executor
        const toolResultHandler = new ToolResultHandler(this.executor, this.resultSummarizer, workspaceRoot, callManager, this.promptAssembler);
        this.slc = new SLCEngine(config, this.promptAssembler, this.canvasManager);
        this.sle = new SLEEngine(config, this.resultSummarizer, toolResultHandler);
        this.registry = SkillRegistry.getInstance();
        this.registry.registerCoreSkills(this.executor, callManager);

        // [V3.6.5] 为 weather_mcp 提供一个 Native 桥接，重用 OpenClaw 的真实执行能力
        // 修正原 skills_repo/weather_mcp/SKILL.md 中 http://localhost:3003/weather 不可用的问题
        this.registry.registerNativeHandler('weather_mcp', async (args: any, callId: string) => {
            const city = args.city || '深圳';
            console.log(`[FastAgentV3] Native Bridge: Executing weather_mcp for city: ${city}`);
            const result = await this.executor.executeOpenClaw(callId, `查询${city}今日天气`, 60000);
            return DelegateExecutor.distill(result);
        });
        this.intentRouter = new IntentRouter(config);
        this.watchdog = new WatchdogService(this.canvasManager, this.instanceId, 1000);
        this.orchestrator = new AgentOrchestrator(this.slc, this.sle, this.intentRouter, this.promptAssembler, this.canvasManager, this.dialogueMemory, this.shadow);
        
        this.init();
    }

    private init() {
        this.startWatchdog(); 
        this.personaInitPromise = this.refreshCompactPersona().catch(() => {}); 
        this.slc.warmUp().catch(() => {});
    }

    private async refreshCompactPersona(callIdOverride?: string) {
        const callId = callIdOverride || getCurrentCallId() || 'global';
        if (AgentOrchestrator.isLocked(callId)) {
            console.log(`[FastAgentV3] Persona refresh skip: session ${callId} is active.`);
            return;
        }

        try {
            const state = this.shadow.getOrCreateState(callId);
            const fullContext = await this.promptAssembler.getContextPrompts(callId, state, false);
            const highResPersona = await this.resultSummarizer.summarizePersona(this.promptAssembler, callId, fullContext);
            if (highResPersona && highResPersona.length > 5) {
                const isPersonaChanged = state.metadata.compact_persona !== highResPersona;
                if (isPersonaChanged) {
                    this.compactPersona = highResPersona;
                    await this.shadow.updateState({ metadata: { compact_persona: highResPersona } });
                    await this.canvasManager.logCanvasEvent(callId, 'PERSONA_REFRESHED', { compact_persona: highResPersona });
                }
            }
        } catch (e) {
            console.error(`[FastAgentV3] Persona refresh failed:`, e);
        } finally {
            // No lock to release here
        }
    }

    private startWatchdog() {
        this.watchdog.on('trigger', async ({ callId, canvas }) => {
            if (this.announcingSessions.has(callId)) return;
            this.announcingSessions.add(callId);
            try {
                // [V3.6.13] 异步触发入口必须绑定上下文，否则下层 LlmLogger/SLC 会丢失 callId
                const { callContextStorage } = require('../context/ctx');
                await callContextStorage.run({ callId, userId: 'system', startTime: Date.now(), metadata: {} }, async () => {
                    const delivered = await this.handleWatchdogTrigger(callId, '__INTERNAL_TRIGGER__');
                    // [V3.6.25] 关键修复：仅当播报成功（未因锁定而跳过）时，才标记为已投递
                    if (delivered) {
                        await this.canvasManager.markAsDelivered(callId);
                    }
                });
            } catch (e) {
                console.error(`[Watchdog Trigger Error] ${callId}:`, e);
            } finally {
                this.announcingSessions.delete(callId);
            }
        });
        this.watchdog.on('idle_trigger', async ({ callId }) => {
            if (callId === 'global' || callId === 'anonymous') return; // [V3.6.13] 屏蔽管理会话与内部匿名会话
            const { callContextStorage } = require('../context/ctx');
            await callContextStorage.run({ callId, userId: 'system', startTime: Date.now(), metadata: {} }, async () => {
                await this.handleWatchdogTrigger(callId, '__IDLE_TRIGGER__');
            });
        });
        this.watchdog.start();
    }

    private async handleWatchdogTrigger(callId: string, trigger: string): Promise<boolean> {
        let out = "";
        const notifier = this.watchdog.getNotifier(callId);
        if (!notifier) return false;

        // [V3.6.4] 触发对应类型的逻辑流程
        const success = await this.process(trigger, (chunk) => {
            if (chunk.content && (chunk.type === 'internal' || chunk.type === 'chat' || chunk.type === 'idle')) {
                out += chunk.content;
            }
        }, undefined, callId);

        if (out.trim()) {
            console.log(`[FastAgentV3] Proactive Broadcast for ${callId} (${trigger}): ${out.trim().substring(0, 50)}...`);
            await notifier(out.trim(), []);
            return true;
        }
        return success;
    }

    async destroySession(callId: string) {
        console.log(`[FastAgentV3][${callId}] 🗑️ Destroying session and unregistering notifier...`);
        this.watchdog.unregisterNotifier(callId);
        this.canvasManager.removeCanvas(callId);
        await this.canvasManager.persistAll().catch(() => {});
        this.processedSessions.delete(callId);
    }

    async process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string, trace?: string[]) => Promise<void>,
        callIdOverride?: string
    ): Promise<boolean> {
        const callId = callIdOverride || getCurrentCallId() || 'anonymous';
        
        // [V3.6.25] 判定锁定类型并注入信号对象以支持强制中断
        const signal = { interrupted: false, slcDone: false };
        let lockType: 'user' | 'internal' | 'idle' = 'user';
        if (text === '__INTERNAL_TRIGGER__') lockType = 'internal';
        else if (text === '__IDLE_TRIGGER__') lockType = 'idle';

        if (!this.orchestrator.tryLockSession(callId, lockType, signal)) {
            console.log(`[FastAgentV3] Session ${callId} is locked by another process (likely User), skipping concurrent ${lockType.toUpperCase()} task.`);
            return false;
        }

        try {
            this.canvasManager.syncEnvContext(callId);
            
            const canvas = this.canvasManager.getCanvas(callId);
            canvas.context.is_busy = true;

            const isNew = !this.processedSessions.has(callId);
            if (isNew) {
                this.processedSessions.add(callId);
                // [V3.6.25] 确保人设已经完成初步汇总加载
                if (this.personaInitPromise) await this.personaInitPromise;
                // [V3.6.25] 状态共济：将初始化阶段或已更新的全局人设注入新会话，防止首轮冷启动失忆
                if (this.compactPersona) {
                    await this.shadow.updateState({ metadata: { compact_persona: this.compactPersona } });
                }
            }
            
            // [V3.6.23] 逻辑极简：运行时不再自动刷新人设快照，仅由 Init 阶段或外部手动触发，保证执行性能
            if (notifier) this.watchdog.registerNotifier(callId, notifier);

            // [V3.6.15] 只有真实的用户输入或内部任务完成才刷新“交互时间”
            // 纯粹的 IDLE_TRIGGER 不应刷新交互时间，否则会进入每 10s 触发一次的死循环
            const isTrigger = text === '__INTERNAL_TRIGGER__' || text === '__IDLE_TRIGGER__';
            if (!isTrigger) {
                canvas.context.last_interaction_time = Date.now();
                canvas.context.idle_trigger_count = 0; 
            }
            
            await this.canvasManager.persistContext(callId);
            let activeTaskId: string | undefined;
            try {
                if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__') {
                    await this.dialogueMemory.logDialogue(callId, 'user', text);
                }
                activeTaskId = canvas.task_status.taskId;
                const trace: string[] = [];
                const result = await this.orchestrator.orchestrate(text, onChunk, callId, isNew, signal, trace, activeTaskId);
                if (result) {
                    canvas.context.last_spoken_fragment = result;
                    await this.dialogueMemory.logDialogue(callId, 'assistant', TextCleaner.decant(result));
                    await this.canvasManager.persistContext(callId); 
                }
                onChunk({ content: '', isFinal: true, type: 'filler', trace });
            } finally { 
                canvas.context.is_busy = false; 
                await this.canvasManager.persistContext(callId); 
            }
            return true;
        } finally {
            this.orchestrator.releaseLockSession(callId);
        }
    }

    destroy() { this.watchdog.stop(); this.processedSessions.clear(); }
}
