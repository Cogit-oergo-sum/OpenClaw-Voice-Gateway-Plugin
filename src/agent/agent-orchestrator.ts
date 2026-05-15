import { EventEmitter } from 'events';
import { FastAgentResponse, CanvasState, RouterResultLite, TaskItem } from './types';
import { SLCEngine } from './slc';
import { SLEEngine } from './sle';
import { IntentRouter } from './intent-router';
import { PromptAssembler } from './prompt-assembler';
import { CanvasManager } from './canvas-manager';
import { DialogueMemory } from './dialogue-memory';
import { TextCleaner } from '../utils/text-cleaner';
import { ShadowManager } from './shadow-manager';
import { CronManager } from './cron-manager';
import { ToolResultHandler } from './tool-result-handler';
import { DelegateExecutor } from './executor';
import { TaskImportanceManager } from './task-importance-config';
import { isPersonaCompactDisabled } from '../system-init';
import { ModeManager } from './mode-manager';  // [V4.7]

/**
 * [V4.0] AgentOrchestrator: 终极调度中枢
 * 继承 EventEmitter 支持即时触发播报机制
 */
export class AgentOrchestrator extends EventEmitter {
    constructor(
        private slc: SLCEngine,
        private sle: SLEEngine,
        private intentRouter: IntentRouter,
        private promptAssembler: PromptAssembler,
        private canvasManager: CanvasManager,
        private dialogueMemory: DialogueMemory,
        private shadow: ShadowManager,
        private toolResultHandler: ToolResultHandler,
        private cronManager: CronManager,
        private executor: DelegateExecutor,
        private taskImportance?: TaskImportanceManager,
        private modeManager?: ModeManager  // [V4.7] 模式管理器（SLE 兜底 MODE_SWITCH）
    ) {
        super();
    }

    private static sessionLocks: Map<string, { type: string; signal: { interrupted: boolean; slcDone: boolean } }> = new Map();

    static isLocked(callId: string): boolean {
        return AgentOrchestrator.sessionLocks.has(callId);
    }

    tryLockSession(callId: string, type: 'user' | 'internal' | 'idle', signal?: { interrupted: boolean; slcDone: boolean }): boolean {
        const currentLock = AgentOrchestrator.sessionLocks.get(callId);

        if (currentLock) {
            if (type === 'user' && (currentLock.type === 'internal' || currentLock.type === 'idle')) {
                console.log(`[AgentOrchestrator][${callId}] USER pre-empting ${currentLock.type.toUpperCase()} lock!`);
                currentLock.signal.interrupted = true;
                this.releaseLockSession(callId);
            } else {
                return false;
            }
        }

        AgentOrchestrator.sessionLocks.set(callId, { type, signal: signal || { interrupted: false, slcDone: false } });
        return true;
    }

    releaseLockSession(callId: string) {
        AgentOrchestrator.sessionLocks.delete(callId);
    }

    async orchestrate(
        text: string,
        onChunk: (resp: FastAgentResponse) => void,
        callId: string,
        isNewSession: boolean,
        signal: { interrupted: boolean; slcDone: boolean },
        trace: string[],
        taskId?: string,
        targetTaskIds?: string[],
        tracker?: any
    ): Promise<string> {
        const canvas = this.canvasManager.getCanvas(callId);
        const source = text === '__INTERNAL_TRIGGER__' ? 'Async-Result-Delivery' :
                      (text === '__IDLE_TRIGGER__' ? 'Watchdog-Idle' : 'User-Input');

        const wrappedOnChunk = (chunk: FastAgentResponse) => {
            canvas.context.last_interaction_time = Date.now();
            onChunk(chunk);
        };

        const isStandardInteraction = text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__' && text !== '__TOOL_WAITING_TRIGGER__';

        if (tracker) tracker.record('ROUTER_START');

        // [V4.0] 极简路由：不再预加载 archive 数据
        const routerPromise = isStandardInteraction
            ? this.intentRouter.detectIntent(text, [], this.promptAssembler, callId)
            : Promise.resolve(null);

        const [managedMessages, routerResultRaw, slcPrompt] = await Promise.all([
            this.dialogueMemory.getHistoryMessages(callId, 20),
            routerPromise,
            this.promptAssembler.assemblePrompt('SLC', callId, this.shadow.getOrCreateState(callId), isNewSession)
        ]);

        if (tracker) tracker.record('ROUTER_END');

        // Watchdog/Internal 触发：直接播报
        if (text === '__INTERNAL_TRIGGER__' || text === '__IDLE_TRIGGER__') {
            const idsToSummarize = targetTaskIds?.length > 0 ? targetTaskIds : (taskId ? [taskId] : []);
            const targetTasks = idsToSummarize.length > 0
                ? canvas.tasks.filter(t => idsToSummarize.includes(t.id))
                : [];

            if (targetTasks.length === 0) return "";

            trace.push(`SLC (聚合播报: ${targetTasks.length}项)`);
            const result = await this.slc.run(text, canvas.context.last_spoken_fragment, targetTasks, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession, tracker, slcPrompt);
            for (const t of targetTasks) t.is_delivered = true;
            await this.canvasManager.persistContext(callId);
            return result;
        }

        // [V4.0] 极简路由结果处理
        const routerResult: RouterResultLite = routerResultRaw || { type: 'chat' };
        trace.push(`ROUTER (${routerResult.type})`);

        return await this.handleRouterResult(
            routerResult, text, callId, canvas, isNewSession,
            managedMessages, signal, trace, wrappedOnChunk, slcPrompt, tracker, source
        );
    }

    /**
     * [V4.0] handleRouterResult: 处理极简路由结果
     */
    private async handleRouterResult(
        routerResult: RouterResultLite,
        text: string,
        callId: string,
        canvas: CanvasState,
        isNewSession: boolean,
        managedMessages: any[],
        signal: { interrupted: boolean; slcDone: boolean },
        trace: string[],
        wrappedOnChunk: (resp: FastAgentResponse) => void,
        slcPrompt: string,
        tracker?: any,
        source: string = 'User-Input'
    ): Promise<string> {

        // canvas: SLC 从画布读取
        if (routerResult.type === 'canvas') {
            const matchedTasks = (routerResult.matchedTaskIds || [])
                .map(id => this.canvasManager.getTask(callId, id))
                .filter(t => !!t) as TaskItem[];

            if (matchedTasks.length === 0) {
                // 无匹配，fallback 到 chat
                return await this.handleChat(text, callId, canvas, isNewSession, managedMessages, signal, trace, wrappedOnChunk, slcPrompt, tracker);
            }

            trace.push(`CANVAS (${matchedTasks.length}项)`);
            const result = await this.slc.run(text, canvas.context.last_spoken_fragment, matchedTasks, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession, tracker, slcPrompt);
            for (const t of matchedTasks) t.is_delivered = true;
            await this.canvasManager.persistContext(callId);
            return result;
        }

        // task: SLC 先安抚（PROGRESS_REPORT），再触发 SLE DECIDING
        if (routerResult.type === 'task') {
            trace.push(`TASK (SLC 安抚 + SLE DECIDING)`);

            // [V4.3] SLC 先跑：带 PROGRESS_REPORT 潜意识安抚用户，enableSleCheck=false 避免重复触发
            await this.slc.run(
                '__TOOL_WAITING_TRIGGER__', canvas.context.last_spoken_fragment, [], this.shadow,
                wrappedOnChunk, signal, managedMessages, isNewSession, tracker, slcPrompt,
                undefined, false, routerResult.matchedSkill
            );

            // SLE DECIDING
            const isolatedSnapshot = JSON.stringify({
                env: canvas.env,
                tasks: canvas.tasks || []
            });

            const sleResult = await this.sle.run(
                managedMessages, text, '全意图判断', this.promptAssembler,
                callId, isolatedSnapshot, this.canvasManager,
                () => {}, signal, source, 'DECIDING', undefined
            );

            const intentType = sleResult.parsed?.intent_type || 'NEW';
            trace.push(`INTENT (${intentType})`);

            return await this.handleIntent(
                intentType, sleResult.parsed, text, callId, canvas, isNewSession,
                managedMessages, signal, trace, wrappedOnChunk, slcPrompt, tracker, source
            );
        }

        // chat: SLC 直接回答
        return await this.handleChat(text, callId, canvas, isNewSession, managedMessages, signal, trace, wrappedOnChunk, slcPrompt, tracker);
    }

    /**
     * [V4.0] handleIntent: 处理 SLE DECIDING 输出的具体意图
     */
    private async handleIntent(
        intentType: string,
        parsed: any,
        text: string,
        callId: string,
        canvas: CanvasState,
        isNewSession: boolean,
        managedMessages: any[],
        signal: { interrupted: boolean; slcDone: boolean },
        trace: string[],
        wrappedOnChunk: (resp: FastAgentResponse) => void,
        slcPrompt: string,
        tracker?: any,
        source: string = 'User-Input'
    ): Promise<string> {

        switch (intentType) {
            case 'MODE_SWITCH': {
                return await this.executeModeSwitch(
                    parsed?.target_mode, parsed?.switch_context, parsed?.pending_intent, parsed?.pending_command,
                    text, callId, canvas, managedMessages, signal, trace, wrappedOnChunk, slcPrompt, tracker
                );
            }
            case 'NEW': {
                // [V4.5] 兜底去重：若画布上已有同名 PENDING 任务，跳过创建，避免重复执行
                const commandText = parsed?.command || text;
                const pendingTasks = canvas.tasks.filter(t => t.status === 'PENDING');
                const duplicateTask = pendingTasks.find(t =>
                    t.name === commandText ||
                    t.summary?.includes(commandText) ||
                    commandText.includes(t.name)
                );
                if (duplicateTask) {
                    console.log(`[Orchestrator][${callId}] DEDUP: skipping NEW, PENDING task "${duplicateTask.name}" (${duplicateTask.id}) already exists`);
                    trace.push(`DEDUP (skip: ${duplicateTask.id})`);
                    return '';
                }

                const taskId = this.canvasManager.createTask(callId, commandText);
                const baseScore = this.taskImportance?.getImportanceScore(parsed?.intent || 'delegate_openclaw') || 3;
                await this.canvasManager.updateTask(callId, taskId, { importance_score: baseScore });

                this.runTask(callId, taskId, commandText, managedMessages, signal, source, [], tracker);

                // [V4.3] SLC 已在 Router=task 时先安抚过，不再二次调 PROGRESS_REPORT
                const newTask = this.canvasManager.getTask(callId, taskId);
                newTask!.is_delivered = true;
                await this.canvasManager.persistContext(callId);
                return '';
            }

            case 'CANCEL': {
                const targetTaskId = parsed?.target_task_id;
                if (targetTaskId) {
                    const task = this.canvasManager.getTask(callId, targetTaskId);
                    this.canvasManager.cancelTask(callId, targetTaskId);
                    if (this.toolResultHandler) this.toolResultHandler.abortTask(targetTaskId);
                    trace.push(`CANCEL (${task?.name || targetTaskId})`);
                    if (task?.tool_agent_id) await this.executor.deleteAgent(task.tool_agent_id);
                }
                wrappedOnChunk({ content: '已取消任务', isFinal: true, type: 'chat' });
                return '已取消任务';
            }

            case 'CONFIRM': {
                const confirmTaskId = parsed?.target_task_id;
                if (confirmTaskId) {
                    const task = this.canvasManager.getTask(callId, confirmTaskId);
                    if (task && task.status === 'AWAITING_CONFIRMATION') {
                        trace.push(`CONFIRM (${task.name})`);
                        const confirmCommand = parsed?.response || text;
                        await this.canvasManager.updateTask(callId, confirmTaskId, {
                            status: 'PENDING',
                            summary: `用户确认: ${confirmCommand}`,
                            version: Date.now()
                        });
                        await this.toolResultHandler.handleToolCalls(
                            [{ function: { name: 'delegate_openclaw', arguments: JSON.stringify({ command: confirmCommand }) } }],
                            text, callId, canvas, this.canvasManager, confirmTaskId
                        );
                    }
                }
                wrappedOnChunk({ content: '好的，继续执行', isFinal: true, type: 'chat' });
                return '好的，继续执行';
            }

            case 'SCHEDULE': {
                this.cronManager.addSchedule({
                    task_name: parsed?.command || '定时任务',
                    query: text,
                    cron: parsed?.cron,
                    callId
                });
                trace.push(`SCHEDULE`);
                wrappedOnChunk({ content: '已设置定时任务', isFinal: true, type: 'chat' });
                return '已设置定时任务';
            }

            case 'NONE': {
                trace.push(`NONE`);
                // [V4.3] SLE 判定不需要工具，SLC 用 sle_check_none 潜意识补一句
                const state = this.shadow.getOrCreateState(callId);
                const noneSlcPrompt = await this.promptAssembler.assemblePrompt('SLC', callId, state, false);
                const result = await this.slc.run(
                    '__REPLY_POLISH_TRIGGER__', canvas.context.last_spoken_fragment, [], this.shadow,
                    wrappedOnChunk, signal, managedMessages, false, tracker, noneSlcPrompt,
                    undefined, false
                );
                return result;
            }

            default: {
                // 兜底：视为 NEW（SLC 已安抚过，不再二次播报）
                const fallbackTaskId = this.canvasManager.createTask(callId, text);
                this.runTask(callId, fallbackTaskId, text, managedMessages, signal, source, [], tracker);
                const fallbackTask = this.canvasManager.getTask(callId, fallbackTaskId);
                fallbackTask!.is_delivered = true;
                await this.canvasManager.persistContext(callId);
                return '';
            }
        }
    }

    /**
     * [V4.0] handleChat: 纯闲聊处理
     * [V4.3] 支持 SLC 触发 trigger_sle_check 后异步 SLE 校验
     */
    private async handleChat(
        text: string,
        callId: string,
        canvas: CanvasState,
        isNewSession: boolean,
        managedMessages: any[],
        signal: { interrupted: boolean; slcDone: boolean },
        trace: string[],
        wrappedOnChunk: (resp: FastAgentResponse) => void,
        slcPrompt: string,
        tracker?: any,
        source: string = 'User-Input'
    ): Promise<string> {
        trace.push(`CHAT`);

        // [V4.3] 监听 SLC 是否触发 trigger_sle_check
        let slcCheckTriggered = false;
        const result = await this.slc.run(
            text, canvas.context.last_spoken_fragment, [], this.shadow,
            wrappedOnChunk, signal, managedMessages, isNewSession, tracker, slcPrompt,
            (name, args) => {
                if (name === 'trigger_sle_check') {
                    slcCheckTriggered = true;
                    trace.push(`SLC_CHECK (${args.reason || ''})`);
                }
            }
        );

        // [V4.3] SLC 触发了意图校验，异步执行 SLE DECIDING
        if (slcCheckTriggered) {
            this.handleSLCCheck(text, callId, canvas, managedMessages, signal, source, wrappedOnChunk, tracker)
                .catch(e => console.error(`[Orchestrator][${callId}] SLE check failed:`, e));
        }

        const state = this.shadow.getOrCreateState(callId);
        if (!isPersonaCompactDisabled() && (isNewSession || !state.metadata.compact_persona)) {
            this.refreshPersona(callId, [...managedMessages, { role: 'user', content: text }, { role: 'assistant', content: result }]);
        }

        return result;
    }

    /**
     * [V4.3] handleSLCCheck: SLC 触发意图校验后的 SLE DECIDING 处理
     * - SLE 判定 NEW → 创建任务 + PROGRESS_REPORT 二次 SLC 播报
     * - SLE 判定 NONE → polishing 二次 SLC 补一句
     */
    private async handleSLCCheck(
        text: string,
        callId: string,
        canvas: CanvasState,
        managedMessages: any[],
        signal: { interrupted: boolean; slcDone: boolean },
        source: string,
        wrappedOnChunk: (resp: FastAgentResponse) => void,
        tracker?: any
    ): Promise<void> {
        console.log(`[Orchestrator][${callId}] SLE check triggered by SLC for: ${text}`);

        // 1. 触发 SLE DECIDING
        const isolatedSnapshot = JSON.stringify({ env: canvas.env, tasks: canvas.tasks || [] });
        const sleResult = await this.sle.run(
            managedMessages, text, '全意图判断', this.promptAssembler,
            callId, isolatedSnapshot, this.canvasManager,
            () => {}, signal, source, 'DECIDING', undefined
        );

        const intentType = sleResult.parsed?.intent_type || 'NONE';
        console.log(`[Orchestrator][${callId}] SLE check result: ${intentType}`);

        if (intentType === 'MODE_SWITCH') {
            await this.executeModeSwitch(
                sleResult.parsed?.target_mode, sleResult.parsed?.switch_context,
                sleResult.parsed?.pending_intent, sleResult.parsed?.pending_command,
                text, callId, canvas, managedMessages, signal, [], wrappedOnChunk, '', tracker
            );
            return;
        }

        if (intentType === 'NEW') {
            // [V4.5] 兜底去重：与 handleIntent(NEW) 同理
            const commandText = sleResult.parsed?.command || text;
            const pendingTasks = canvas.tasks.filter(t => t.status === 'PENDING');
            const duplicateTask = pendingTasks.find(t =>
                t.name === commandText ||
                t.summary?.includes(commandText) ||
                commandText.includes(t.name)
            );
            if (duplicateTask) {
                console.log(`[Orchestrator][${callId}] SLE_CHECK DEDUP: skipping NEW, PENDING task "${duplicateTask.name}" (${duplicateTask.id}) already exists`);
                return;
            }

            // 2a. 需要工具 → 创建任务 + PROGRESS_REPORT
            const taskId = this.canvasManager.createTask(callId, commandText);
            const baseScore = this.taskImportance?.getImportanceScore(sleResult.parsed?.intent || 'delegate_openclaw') || 3;
            await this.canvasManager.updateTask(callId, taskId, { importance_score: baseScore });

            this.runTask(callId, taskId, commandText, managedMessages, signal, source, [], tracker);

            // 二次 SLC 调用：PROGRESS_REPORT 播报
            const newTask = this.canvasManager.getTask(callId, taskId);
            const state = this.shadow.getOrCreateState(callId);
            const slcPrompt = await this.promptAssembler.assemblePrompt('SLC', callId, state, false);
            await this.slc.run(
                '__TOOL_WAITING_TRIGGER__', canvas.context.last_spoken_fragment, [newTask!], this.shadow,
                wrappedOnChunk, signal, managedMessages, false, tracker, slcPrompt
            );
            newTask!.is_delivered = true;
            await this.canvasManager.persistContext(callId);
        } else {
            // 2b. 不需要工具 → polishing 补一句
            const state = this.shadow.getOrCreateState(callId);
            const slcPrompt = await this.promptAssembler.assemblePrompt('SLC', callId, state, false);
            await this.slc.run(
                '__REPLY_POLISH_TRIGGER__', canvas.context.last_spoken_fragment, [], this.shadow,
                wrappedOnChunk, signal, managedMessages, false, tracker, slcPrompt
            );
        }
    }

    /**
     * runTask: 异步启动任务
     */
    private async runTask(callId: string, taskId: string, query: string, history: any[], signal: any, source: string, predecessorTasks: TaskItem[] = [], tracker?: any) {
        const canvas = this.canvasManager.getCanvas(callId);
        const task = this.canvasManager.getTask(callId, taskId);
        if (!task) return;

        const isolatedSnapshot = JSON.stringify({
            env: canvas.env,
            tasks: [...predecessorTasks, task]
        });

        if (tracker) tracker.record('SLE_START');
        return this.sle.run(
            history, query, query, this.promptAssembler,
            callId, isolatedSnapshot, this.canvasManager,
            () => {}, signal, source, 'DECIDING', taskId, tracker  // [V3.7.2] 传递 tracker
        ).then(res => {
            if (tracker) tracker.record('SLE_END');
            return res;
        }).catch(e => {
            if (tracker) tracker.record('SLE_END');
            console.error(`[Orchestrator] Task ${taskId} failed:`, e);
        });
    }

    /**
     * [V4.7] 执行模式切换（SLE 兜底路径，与 SLC mode_switch 逻辑对齐）
     */
    private async executeModeSwitch(
        targetMode: string | undefined,
        switchContext: any,
        pendingIntent: string | undefined,
        pendingCommand: string | undefined,
        text: string,
        callId: string,
        canvas: CanvasState,
        managedMessages: any[],
        signal: { interrupted: boolean; slcDone: boolean },
        trace: string[],
        wrappedOnChunk: (resp: FastAgentResponse) => void,
        slcPrompt: string,
        tracker?: any
    ): Promise<string> {
        if (!targetMode || !this.modeManager || !this.modeManager.hasMode(targetMode)) {
            console.warn(`[Orchestrator][${callId}] MODE_SWITCH: invalid target_mode "${targetMode}", skip`);
            return '';
        }

        const currentMode = this.shadow.getOrCreateState(callId).metadata.current_mode || this.modeManager.getInitialMode();
        if (targetMode === currentMode) {
            console.log(`[Orchestrator][${callId}] MODE_SWITCH: target=${targetMode} same as current, skip`);
            return '';
        }

        trace.push(`MODE_SWITCH (${currentMode} → ${targetMode})`);
        console.log(`[Orchestrator][${callId}] MODE_SWITCH: ${currentMode} → ${targetMode}`);

        // 1. 更新 ShadowState
        await this.shadow.updateState({
            metadata: {
                current_mode: targetMode,
                mode_pending_injection: targetMode,
                switch_context: switchContext || null
            }
        }, callId);

        // 2. 补发过渡语
        wrappedOnChunk({ content: '好的，我来看看~', isFinal: false, type: 'chat', mode: targetMode });

        // 3. 二次 SLC：用新 mode prompt 回答用户原始问题
        const state = this.shadow.getOrCreateState(callId);
        const modeSlcPrompt = await this.promptAssembler.assemblePrompt('SLC', callId, state, false);
        await this.slc.run(
            text, canvas.context.last_spoken_fragment, [], this.shadow,
            wrappedOnChunk, signal, managedMessages, false, tracker, modeSlcPrompt,
            undefined, false  // disableSleCheck=true 避免循环触发
        );

        // 4. 通知前端模式已切换
        wrappedOnChunk({
            content: '',
            isFinal: true,
            type: 'mode_update',
            mode: targetMode,
            modeDescription: this.modeManager.getModeDescriptions().split('\n')
                .find(line => line.startsWith(`- ${targetMode}:`))
                ?.replace(`- ${targetMode}: `, '') || targetMode
        });

        // 5. 如果 MODE_SWITCH 同时伴随工具调用需求
        if (pendingIntent && pendingCommand) {
            const pendingTaskId = this.canvasManager.createTask(callId, pendingCommand);
            const baseScore = this.taskImportance?.getImportanceScore(pendingIntent || 'delegate_openclaw') || 3;
            await this.canvasManager.updateTask(callId, pendingTaskId, { importance_score: baseScore });
            this.runTask(callId, pendingTaskId, pendingCommand, managedMessages, signal, 'ModeSwitch-Deferred', [], tracker);
            const pendingTask = this.canvasManager.getTask(callId, pendingTaskId);
            if (pendingTask) pendingTask.is_delivered = true;
            await this.canvasManager.persistContext(callId);
        }

        // 6. 标记已注入
        state.metadata.mode_pending_injection = null;
        state.metadata.mode_injected = targetMode;

        return '';
    }

    /**
     * refreshPersona: 后台提炼人设
     */
    private async refreshPersona(callId: string, history: any[]) {
        const state = this.shadow.getOrCreateState(callId);
        const canvas = this.canvasManager.getCanvas(callId);

        console.log(`[Orchestrator][${callId}] Persona Refresh...`);

        try {
            const sleResult = await this.sle.run(
                history, "__REFINING_TRIGGER__", "人设提炼", this.promptAssembler,
                callId, JSON.stringify({ env: canvas.env, tasks: canvas.tasks }), this.canvasManager,
                () => {}, { interrupted: false, slcDone: false }, 'Internal', 'REFINING'
            );

            if (sleResult.parsed?.compact_persona) {
                await this.shadow.updateState({ metadata: { compact_persona: sleResult.parsed.compact_persona } }, callId);
                console.log(`[Orchestrator][${callId}] Persona updated.`);
            }
        } catch (e) {
            console.warn(`[Orchestrator][${callId}] Persona Refresh failed:`, e);
        }
    }

    /**
     * finalizeTaskSummarization: 任务终结提纯
     * [V3.7.2] 增加 tracker 参数用于记录 SUMMARIZE 耗时
     */
    async finalizeTaskSummarization(callId: string, taskId: string, rawResult: string, tracker?: any) {
        const canvas = this.canvasManager.getCanvas(callId);
        const task = this.canvasManager.getTask(callId, taskId);
        if (!task) return;

        console.log(`[Orchestrator][${callId}] Task ${taskId} finished. Refining...`);

        // [V3.7.2] 耗时追踪: Summarize 开始
        if (tracker) tracker.record('SUMMARIZE_START');

        try {
            await this.canvasManager.updateTask(callId, taskId, { summary: rawResult });

            const history = await this.dialogueMemory.getHistoryMessages(callId, 5);
            const snapshot = JSON.stringify({ env: canvas.env, tasks: [task] });
            const sleResult = await this.sle.run(
                history, "__INTERNAL_TRIGGER__", "结果提纯", this.promptAssembler,
                callId, snapshot, this.canvasManager,
                () => {}, { interrupted: false, slcDone: false }, 'Async-Result-Delivery', 'SUMMARIZING', taskId
            );

            const parsedStatus = sleResult.parsed?.status || 'READY';
            const pendingQuestions = sleResult.parsed?.pending_questions || [];

            const updateData: any = {
                summary: sleResult.parsed?.direct_response || sleResult.output || rawResult,
                direct_response: sleResult.parsed?.direct_response,
                extended_context: sleResult.parsed?.extended_context,
                status: parsedStatus,
                importance_score: sleResult.parsed?.importance_score || 7,
                is_delivered: false,
            };

            if (pendingQuestions.length > 0 || parsedStatus === 'AWAITING_CONFIRMATION') {
                updateData.pending_questions = pendingQuestions;
                updateData.status = 'AWAITING_CONFIRMATION';
                updateData.importance_score = 8;
                console.log(`[Orchestrator][${callId}] Task ${taskId} awaiting confirmation.`);
            } else {
                updateData.completed_at = Date.now();
                if (task.tool_agent_id) {
                    await this.executor.deleteAgent(task.tool_agent_id);
                    console.log(`[Orchestrator][${callId}] Agent ${task.tool_agent_id} deleted.`);
                }
            }

            await this.canvasManager.updateTask(callId, taskId, updateData);
            console.log(`[Orchestrator][${callId}] Task ${taskId} is ${updateData.status}.`);

            // [V3.7.2] 耗时追踪: Summarize 完成
            if (tracker) tracker.record('SUMMARIZE_END');

            const immediateThreshold = this.taskImportance?.getImmediateTriggerThreshold() || 8;
            if (updateData.importance_score >= immediateThreshold) {
                console.log(`[Orchestrator][${callId}] IMMEDIATE_TRIGGER for ${taskId}`);
                this.emit('IMMEDIATE_TRIGGER', { callId, taskId });
            }
        } catch (e) {
            // [V3.7.2] 耗时追踪: Summarize 失败也记录结束时间
            if (tracker) tracker.record('SUMMARIZE_END');
            console.error(`[Orchestrator] Summarization failed for ${taskId}:`, e);
            // [V4.6] 提纯失败应标记 FAILED，与 ToolResultHandler 异常路径对齐
            await this.canvasManager.updateTask(callId, taskId, { status: 'FAILED', completed_at: Date.now() });
            if (task.tool_agent_id) await this.executor.deleteAgent(task.tool_agent_id);
        }
    }
}