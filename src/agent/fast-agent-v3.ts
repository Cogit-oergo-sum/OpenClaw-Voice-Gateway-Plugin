import * as path from 'path';
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
import { TaskDelegateSkill } from './skills/core/task-delegate';
import { CronManager } from './cron-manager';
import { TaskImportanceManager } from './task-importance-config';
import { ModeManager } from './mode-manager';
import { isPersonaCompactDisabled } from '../system-init';
import axios from 'axios';

/**
 * [V3.6.0] FastAgentV3: 终极 Facade 调度中枢
 * [V4.1] 集成 ModeManager 支持模式切换
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
    private taskImportance: TaskImportanceManager; // [V3.11] 任务重要性配置管理
    private modeManager: ModeManager; // [V4.1] 模式管理器

    private compactPersona: string = "你是 Jarvis。用户是 先生。";
    private instanceId: string = Math.random().toString(36).substring(7);
    private processedSessions: Set<string> = new Set();
    private announcingSessions: Set<string> = new Set();
    private personaInitPromise: Promise<void> | null = null;

    constructor(private config: PluginConfig, private workspaceRoot: string, private callManager?: CallManager) {
        this.dialogueMemory = new DialogueMemory(workspaceRoot);
        this.shadow = new ShadowManager(workspaceRoot);
        this.canvasManager = new CanvasManager(workspaceRoot);
        this.promptAssembler = new PromptAssembler(workspaceRoot, this.dialogueMemory, this.canvasManager, this.shadow);
        // [V4.1] 设置 personaSource，从环境变量读取
        const personaSource = process.env.VOICE_GATEWAY_PERSONA_SOURCE === 'openclaw' ? 'openclaw' : 'local';
        this.promptAssembler.setPersonaSource(personaSource);
        if (personaSource === 'openclaw') {
            const openclawPath = process.env.OPENCLAW_WORKSPACE || process.env.OPENCLAW_PROFILE;
            if (openclawPath) {
                this.promptAssembler.setOpenClawWorkspacePath(path.resolve(openclawPath));
            }
        }
        // [V4.7] 支持 persona 变体子目录透传
        const personaSubDir = process.env.VOICE_GATEWAY_PERSONA_SUBDIR || '';
        if (personaSubDir) {
            this.promptAssembler.setPersonaSubDir(personaSubDir);
        }
        console.log(`[FastAgentV3] personaSource=${personaSource}, workspaceRoot=${workspaceRoot}, personaSubDir=${personaSubDir || '(default)'}`);
        this.resultSummarizer = new ResultSummarizer(config);
        this.executor = new DelegateExecutor(workspaceRoot);
        // [V3.11] 初始化 TaskImportanceManager
        this.taskImportance = new TaskImportanceManager(workspaceRoot);
        const toolResultHandler = new ToolResultHandler(this.executor, this.resultSummarizer, workspaceRoot, callManager, this.promptAssembler);
        this.slc = new SLCEngine(config, this.promptAssembler, this.canvasManager);
        this.sle = new SLEEngine(config, this.resultSummarizer, toolResultHandler);
        this.registry = SkillRegistry.getInstance();
        this.registry.registerCoreSkills(this.executor, callManager);

        // [V4.1] 初始化 ModeManager 并注入到 SLC 和 PromptAssembler
        this.modeManager = new ModeManager(workspaceRoot);
        this.slc.setModeManager(this.modeManager);
        this.promptAssembler.setModeManager(this.modeManager);

        // [V3.6.5] 为 weather_mcp 提供一个 Native 桥接
        this.registry.registerNativeHandler('weather_mcp', async (args: any, callId: string) => {
            const city = args.city || '深圳';
            console.log(`[FastAgentV3] Native Bridge: Executing weather_mcp for city: ${city}`);
            const result = await this.executor.executeOpenClawWithAgent(callId, `查询${city}今日天气`, 60000);
            return DelegateExecutor.distill(result);
        });

        // [V4.4] 为 delegate_task 提供完整 Native 桥接（5 参数协议）
        const delegateSkill = new TaskDelegateSkill(this.executor);
        this.registry.registerNativeHandler('delegate_task', async (
            args: any, callId: string, canvasManager: CanvasManager,
            taskId?: string, options?: any
        ) => {
            return delegateSkill.execute(args, callId, canvasManager, taskId, options);
        });
        this.registry.registerAlias('delegate_openclaw', 'delegate_task');

        // [V4.5] 为 zego_doc_query 提供 Native 桥接（通过本地 MCP Proxy 分发）
        this.registry.registerNativeHandler('zego_doc_query', async (args: any) => {
            const { action, ...params } = args;
            const PROXY = process.env.ZEGO_MCP_PROXY || 'http://localhost:3004';

            const ACTION_ROUTES: Record<string, string> = {
                get_zego_product_datasets: '/get_zego_product_datasets',
                get_platforms_by_product: '/get_platforms_by_product',
                get_doc_links: '/get_doc_links',
                search_zego_docs: '/search_zego_docs',
                get_token_generate_doc: '/get_token_generate_doc',
                get_server_signature_doc: '/get_server_signature_doc',
            };

            const route = ACTION_ROUTES[action];
            if (!route) throw new Error(`zego_doc_query: unknown action "${action}". Valid: ${Object.keys(ACTION_ROUTES).join(', ')}`);

            let body: Record<string, any> = {};
            switch (action) {
                case 'get_platforms_by_product':
                    body = { product: params.product };
                    break;
                case 'get_doc_links':
                    body = { product: params.product, platform_index: params.platform_index };
                    break;
                case 'search_zego_docs':
                    body = { query: params.query, dataset_ids: params.dataset_ids, product: params.product };
                    break;
                case 'get_token_generate_doc':
                case 'get_server_signature_doc':
                    body = { language: params.language || 'NODEJS' };
                    break;
            }

            console.log(`[FastAgentV3] zego_doc_query bridge: ${action} -> ${route}`);
            const res = await axios.post(`${PROXY}${route}`, body, { timeout: 15000 });
            return typeof res.data === 'string' ? res.data : JSON.stringify(res.data, null, 2);
        });

        this.intentRouter = new IntentRouter(config);
        const cronManager = new CronManager(workspaceRoot);
        // [V3.11] 注入 TaskImportanceManager 到 Watchdog
        this.watchdog = new WatchdogService(this.canvasManager, this.dialogueMemory, cronManager, this.instanceId, 1000, this.taskImportance);
        // [V3.11] 传递 taskImportance 以支持即时触发和动态阈值
        this.orchestrator = new AgentOrchestrator(this.slc, this.sle, this.intentRouter, this.promptAssembler, this.canvasManager, this.dialogueMemory, this.shadow, toolResultHandler, cronManager, this.executor, this.taskImportance, this.modeManager);
        
        // [V3.9] 监听定时触发事件
        this.watchdog.on('SCHEDULE_TRIGGERED', ({ callId, taskId, query }) => {
            console.log(`[FastAgentV3] ⏰ Schedule triggered auto-execution for task ${taskId}`);
            this.orchestrator.orchestrate(
                query,
                (chunk) => { /* 定时任务的播报由 Watchdog 扫描 Canvas 触发，这里通常静默或记录 */ },
                callId,
                false,
                { interrupted: false, slcDone: false },
                [`SCHEDULE_EXEC(${taskId})`],
                taskId
            ).catch(e => console.error(`[FastAgentV3] Schedule execution failed:`, e));
        });
        
        // [V3.7.1] 注入任务完成回调：工具执行结束后 -> Orchestrator 提纯 -> 此时才标记 READY 触发 Watchdog
        // [V3.7.2] 增加 tracker 参数传递
        toolResultHandler.setTaskReadyCallback((cid, tid, res, tracker) => this.orchestrator.finalizeTaskSummarization(cid, tid, res, tracker));
        
        this.init();
    }

    private init() {
        this.startWatchdog();
        this.slc.warmUp().catch(() => {});
        this.reconcileTasks().catch(e => console.error(`[FastAgentV3] Reconciliation failed:`, e));
        // [V4.1] 加载模式定义
        this.modeManager.loadFromDirectory().catch(e => console.error(`[FastAgentV3] ModeManager load failed:`, e));
    }

    /**
     * [V3.9] 任务对账逻辑：重启后扫描 Canvas，处理残留的 PENDING 任务
     */
    private async reconcileTasks() {
        await this.canvasManager.syncCanvasesFromDisk();
        const canvases = this.canvasManager.getCanvases();
        for (const [callId, canvas] of canvases.entries()) {
            for (const task of canvas.tasks) {
                if (task.status === 'PENDING') {
                    console.log(`[FastAgentV3] 🕵️ Reconciling PENDING task ${task.id} in session ${callId}`);
                    // 极简策略：如果是过期的 PENDING（比如超过 10 分钟），标记为 FAILED
                    const age = Date.now() - (task.updated_at || task.created_at || Date.now());
                    if (age > 10 * 60 * 1000) {
                        await this.canvasManager.updateTask(callId, task.id, {
                            status: 'FAILED',
                            summary: '任务进程在网关重启期间已中断。',
                            importance_score: 5,
                            is_delivered: false
                        });
                    }
                }
            }
        }
    }

    /**
     * [V4.2] 人设刷新逻辑重构
     * - 先检查原始拼接内容的字数
     * - 只有超过 3000 字才调用 SLE 压缩提炼
     * - 压缩后存入 compact_persona 并标记已完成
     */
    private async refreshCompactPersona(callIdOverride?: string) {
        if (isPersonaCompactDisabled()) {
            console.log(`[FastAgentV3] Persona compact disabled by VOICE_GATEWAY_DISABLE_PERSONA_COMPACT`);
            return;
        }
        const callId = callIdOverride || getCurrentCallId() || 'global';
        if (AgentOrchestrator.isLocked(callId)) {
            console.log(`[FastAgentV3] Persona refresh skip: session ${callId} is active.`);
            return;
        }

        try {
            const state = this.shadow.getOrCreateState(callId);

            // [V4.2] 获取原始拼接内容并检查字数
            const rawPrompt = await this.promptAssembler.buildRawPromptForCompression();
            const charCount = rawPrompt.length;

            // 只有超过 3000 字才需要压缩
            if (charCount <= 3000) {
                console.log(`[FastAgentV3] 原始提示词 ${charCount} 字 ≤ 3000，无需压缩`);
                return;
            }

            console.log(`[FastAgentV3] 原始提示词 ${charCount} 字 > 3000，触发压缩`);

            // 调用 SLE 进行压缩提炼
            const highResPersona = await this.resultSummarizer.summarizePersona(this.promptAssembler, callId, rawPrompt);
            if (highResPersona && highResPersona.length > 5) {
                const isPersonaChanged = state.metadata.compact_persona !== highResPersona;
                if (isPersonaChanged) {
                    this.compactPersona = highResPersona;
                    // [V4.2] 存储 compact_persona 和原始字数（用于后续判断是否需要重新压缩）
                    await this.shadow.updateState({
                        metadata: {
                            compact_persona: highResPersona,
                            last_persona_char_count: charCount
                        }
                    });
                    // [V4.2] 标记该 callId 已完成压缩
                    this.promptAssembler.markCompressed(callId);
                    await this.canvasManager.logCanvasEvent(callId, 'PERSONA_COMPRESSED', {
                        original_chars: charCount,
                        compressed_chars: highResPersona.length
                    });
                }
            }
        } catch (e) {
            console.error(`[FastAgentV3] Persona refresh failed:`, e);
        } finally {
            // No lock to release here
        }
    }

    private startWatchdog() {
        this.watchdog.on('trigger', async ({ callId, tasks }) => {
            if (this.announcingSessions.has(callId)) return;
            this.announcingSessions.add(callId);
            try {
                // [V3.6.13] 异步触发入口必须绑定上下文，否则下层 LlmLogger/SLC 会丢失 callId
                const { callContextStorage } = require('../context/ctx');
                await callContextStorage.run({ callId, userId: 'system', startTime: Date.now(), metadata: {} }, async () => {
                    const delivered = await this.handleWatchdogTrigger(callId, '__INTERNAL_TRIGGER__', tasks);
                    // [V3.6.25] 关键修复：仅当播报成功（未因锁定而跳过）时，才标记为已投递
                    if (delivered) {
                        for (const t of tasks) {
                            await this.canvasManager.markAsDelivered(callId, t.id);
                        }
                    }
                });
            } catch (e) {
                console.error(`[Watchdog Trigger Error] ${callId}:`, e);
            } finally {
                this.announcingSessions.delete(callId);
            }
        });
        this.watchdog.on('idle_trigger', async ({ callId }) => {
            if (callId === 'global' || callId === 'anonymous') return;
            const { callContextStorage } = require('../context/ctx');
            await callContextStorage.run({ callId, userId: 'system', startTime: Date.now(), metadata: {} }, async () => {
                await this.handleWatchdogTrigger(callId, '__IDLE_TRIGGER__');
            });
        });

        // [V3.11] 监听即时触发事件：高优先任务完成后立即播报，不等待 Watchdog 扫描
        this.orchestrator.on('IMMEDIATE_TRIGGER', async ({ callId, taskId }) => {
            if (this.announcingSessions.has(callId)) return;
            this.announcingSessions.add(callId);
            try {
                const { callContextStorage } = require('../context/ctx');
                await callContextStorage.run({ callId, userId: 'system', startTime: Date.now(), metadata: {} }, async () => {
                    const task = this.canvasManager.getTask(callId, taskId);
                    if (task && !task.is_delivered) {
                        const delivered = await this.handleWatchdogTrigger(callId, '__INTERNAL_TRIGGER__', [task]);
                        if (delivered) {
                            await this.canvasManager.markAsDelivered(callId, taskId);
                        }
                    }
                });
            } catch (e) {
                console.error(`[IMMEDIATE_TRIGGER Error] ${callId}:`, e);
            } finally {
                this.announcingSessions.delete(callId);
            }
        });

        this.watchdog.start();
    }

    private async handleWatchdogTrigger(callId: string, trigger: string, tasks: import('./types').TaskItem[] = []): Promise<boolean> {
        let out = "";
        const notifier = this.watchdog.getNotifier(callId);
        if (!notifier) return false;

        const taskIds = tasks.map(t => t.id);
        // [V3.6.4] 触发对应类型的逻辑流程
        const success = await this.process(trigger, (chunk) => {
            if (chunk.content && (chunk.type === 'internal' || chunk.type === 'chat' || chunk.type === 'idle')) {
                out += chunk.content;
            }
        }, undefined, callId, taskIds);

        if (out.trim()) {
            console.log(`[FastAgentV3] Proactive Broadcast for ${callId} (${trigger}): ${out.trim().substring(0, 50)}...`);
            try {
                await notifier(out.trim(), []);
            } catch (e) {
                console.error(`[FastAgentV3] Proactive Broadcast failed for ${callId} (ZEGO may be in listening state):`, e);
            }
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
        callIdOverride?: string,
        targetTaskIds?: string[]
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
                // [V3.7] 仅在对话启动 (isNew) 时异步触发一次全局人设刷新（状态共济）
                // 确保人设已经完成初步汇总加载，防止首轮冷启动失忆
                this.personaInitPromise = this.refreshCompactPersona(callId).catch(() => {});
                if (this.personaInitPromise) await this.personaInitPromise;
                
                if (this.compactPersona) {
                    await this.shadow.updateState({ metadata: { compact_persona: this.compactPersona } });
                }
            }
            
            // [V3.6.23] 逻辑极简：运行时不再自动刷新人设快照，仅由 Init 阶段或外部手动触发，保证执行性能
            if (notifier) this.watchdog.registerNotifier(callId, notifier);

            // [V3.6.15] 只有真实的用户输入或内部任务完成才刷新“交互时间”
            // 纯粹的 IDLE_TRIGGER 不应刷新交互时间，否则会进入每 10s 触发一次的死循环
            const isTrigger = text === '__INTERNAL_TRIGGER__' || text === '__IDLE_TRIGGER__';
            if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__') {
                canvas.context.last_interaction_time = Date.now();
                canvas.context.idle_trigger_count = 0; 
            }
            
            await this.canvasManager.persistContext(callId);
            let activeTaskId: string | undefined;
            
            // [V3.7.2] 耗时追踪: 初始化
            const { LatencyTracker } = require('../utils/latency-tracker');
            const tracker = new LatencyTracker(callId, text.startsWith('__') ? text : 'User-Input');
            
            const wrappedOnChunkWithTracker = (resp: FastAgentResponse) => {
                onChunk(resp);
            };
            (wrappedOnChunkWithTracker as any).tracker = tracker;

            try {
                if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__') {
                    await this.dialogueMemory.logDialogue(callId, 'user', text);
                }
                activeTaskId = (targetTaskIds && targetTaskIds.length > 0) ? targetTaskIds[0] : canvas.task_status.taskId;
                const trace: string[] = [];
                // [V3.7] 支持传递多任务 ID 列表进行聚合播报
                const result = await this.orchestrator.orchestrate(text, wrappedOnChunkWithTracker, callId, isNew, signal, trace, activeTaskId, targetTaskIds, tracker);
                
                // [V3.7.2] 打印耗时报表并发送至前端
                const perf = tracker.getMetrics();
                console.log(tracker.getSummary());

                if (result) {
                    canvas.context.last_spoken_fragment = result;
                    await this.dialogueMemory.logDialogue(callId, 'assistant', TextCleaner.decant(result));
                    await this.canvasManager.persistContext(callId); 
                }
                onChunk({ content: '', isFinal: true, type: 'filler', trace, perf });
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

    /**
     * [V4.1] 获取当前 workspace 的 mode 信息（供前端初始化展示）
     */
    getModeInfo(): { initialMode: string; modes: { name: string; description: string }[] } {
        const modes = Array.from(this.modeManager.getModeNames().map(name => ({
            name,
            description: this.modeManager.getModeDescriptions().split('\n')
                .find(line => line.startsWith(`- ${name}:`))
                ?.replace(`- ${name}: `, '') || name
        })));
        return {
            initialMode: this.modeManager.getInitialMode(),
            modes
        };
    }
}
