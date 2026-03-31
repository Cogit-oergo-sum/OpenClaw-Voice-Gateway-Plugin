import { FastAgentResponse, CanvasState } from './types';
import { SLCEngine } from './slc';
import { SLEEngine } from './sle';
import { IntentRouter } from './intent-router';
import { PromptAssembler } from './prompt-assembler';
import { CanvasManager } from './canvas-manager';
import { DialogueMemory } from './dialogue-memory';
import { ShadowManager } from './shadow-manager';

export class AgentOrchestrator {
    constructor(
        private slc: SLCEngine,
        private sle: SLEEngine,
        private intentRouter: IntentRouter,
        private promptAssembler: PromptAssembler,
        private canvasManager: CanvasManager,
        private dialogueMemory: DialogueMemory,
        private shadow: ShadowManager
    ) {}

    // [V3.6.25] 扩展锁机制：支持任务类型区分与信号传递
    private static sessionLocks: Map<string, { type: string; signal: { interrupted: boolean; slcDone: boolean } }> = new Map();
    private static abortControllers: Map<string, AbortController> = new Map();

    static isLocked(callId: string): boolean {
        return AgentOrchestrator.sessionLocks.has(callId);
    }

    /**
     * [V3.6.25] tryLockSession: 抢占式锁定逻辑
     * 支持 USER 输入强制中断正在进行的 INTERNAL 或 IDLE 播报，保证用户输入的高优先级响应。
     */
    tryLockSession(callId: string, type: 'user' | 'internal' | 'idle', signal?: { interrupted: boolean; slcDone: boolean }): boolean {
        const currentLock = AgentOrchestrator.sessionLocks.get(callId);
        
        if (currentLock) {
            // 抢占策略：仅当新请求是 'user' 且旧请求是 'internal' 或 'idle' 时，才允许抢占
            if (type === 'user' && (currentLock.type === 'internal' || currentLock.type === 'idle')) {
                console.log(`[AgentOrchestrator][${callId}] 🚨 USER pre-empting ${currentLock.type.toUpperCase()} lock! Interrupting previous session...`);
                // 标记旧任务中断
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
        taskId?: string // [V3.6.21] 任务追踪 ID
    ): Promise<string> {
        const isReplyPolishTrigger = text === '__REPLY_POLISH_TRIGGER__';
        const canvas = this.canvasManager.getCanvas(callId);
            const canvasSnapshot = JSON.stringify({
                env: canvas.env,
                task_status: canvas.task_status,
                last_spoken_fragment: canvas.context.last_spoken_fragment || '无'
            });

            // 异步更新活跃时间
            const wrappedOnChunk = (chunk: FastAgentResponse) => {
                canvas.context.last_interaction_time = Date.now();
                onChunk(chunk);
            };

            let managedMessages = await this.dialogueMemory.getHistoryMessages(callId, 20);
            const lastMsg = managedMessages[managedMessages.length - 1];
            if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__TOOL_WAITING_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__') {
                // [V3.6.11] 最终去重：如果历史里已经有了最新的 User 输入（由 FastAgentV3 预写入），则不再重复 push
                if (!(lastMsg?.role === 'user' && lastMsg.content === text)) {
                    managedMessages.push({ role: 'user', content: text });
                }
            }

            // 1. 同步判定意图
            let needsTool = false;
            let toolIntent = "";
            let isAnswerInCanvas = false;
            if (text !== '__INTERNAL_TRIGGER__' && text !== '__IDLE_TRIGGER__' && text !== '__REPLY_POLISH_TRIGGER__') {
                const detection = await this.intentRouter.detectIntent(text, managedMessages, this.promptAssembler, callId);
                needsTool = detection.needsTool;
                toolIntent = detection.intent || "";
                isAnswerInCanvas = !!detection.isAnswerInCanvas;
                trace.push(`SLE (意图分析: ${needsTool ? '任务 - ' + toolIntent : (isAnswerInCanvas ? '命中画布知识' : '进入闲聊')})`);
            }

            // 2. 执行分流
            // [V3.6.10] 统一来源判定
            let source = 'User-Input';
            if (text === '__INTERNAL_TRIGGER__') source = 'Async-Result-Delivery';
            else if (text === '__IDLE_TRIGGER__') source = 'Watchdog-Idle';
            else if (isReplyPolishTrigger) source = 'Reply-Polishing';

            if (text === '__INTERNAL_TRIGGER__' || text === '__IDLE_TRIGGER__') {
                const isIdle = text === '__IDLE_TRIGGER__';
                if (isIdle) {
                    trace.push('SLC (打断沉默/发起话题)');
                } else {
                    trace.push('SLE (专家结果提纯)');
                }
                
                let directResponse = canvas.task_status.direct_response || canvas.task_status.summary;
                if (!isIdle) {
                    // [V3.6.17] 强制原子化提纯：如果是后台结果回报，通过 SUMMARIZING 场景生成结构化摘要，防止 SLC 直接读取 raw 输出产生幻觉
                    const sleResult = await this.sle.run(
                        managedMessages, text, "任务后台同步回报事实", 
                        this.promptAssembler, callId, canvasSnapshot, 
                        this.canvasManager, () => {}, signal, source, 'SUMMARIZING', taskId
                    ).catch(e => ({ output: "", toolCalls: [], intent: "", parsed: null }));

                    if (sleResult.output) {
                        directResponse = sleResult.output;
                        trace.push('SLE (专家提纯完成)');

                        // [V3.6.4] 状态分发：更新画布以反映提纯后的结果，而非 raw 输出
                        await this.canvasManager.appendCanvasAudit(
                            callId, 
                            sleResult.parsed || { direct_response: sleResult.output }, 
                            'READY',
                            true, // marks as delivered to task flow, actually it's a summary of results
                            taskId
                        );
                        trace.push(`SLE (画布同步: READY)`);
                    }
                }
                return await this.slc.run(text, canvas.context.last_spoken_fragment, directResponse, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
            } else if (needsTool) {
                // [V3.6.15修复] 逻辑重置点：仅在确认需要启动新工具时，才清理画布并分配新的 taskId
                taskId = this.canvasManager.resetTaskStatus(callId);
                trace.push('SLC (即时反馈/垫词)');
                trace.push('SLE (逻辑决策/工具启动)');
                const slcPromise = this.slc.run('__TOOL_WAITING_TRIGGER__', canvas.context.last_spoken_fragment, toolIntent, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
                const slePromise = this.sle.run(managedMessages, text, toolIntent, this.promptAssembler, callId, canvasSnapshot, this.canvasManager, () => {}, signal, source, 'DECIDING', taskId);
                
                const [slcOut, sleResult] = await Promise.all([slcPromise, slePromise]);
                
                if (!sleResult.toolCalls?.length && sleResult.output && !sleResult.intent) {
                    trace.push('SLE (直答结果)');
                    // [V3.6.15修复] 必须先将直答结果同步到画布，否则 Reply-Polishing 场景无法通过 canvas 获取到 direct_response
                    await this.canvasManager.appendCanvasAudit(
                        callId, 
                        sleResult.parsed || { direct_response: sleResult.output }, 
                        'READY',
                        true,
                        taskId
                    );
                    return await this.orchestrate('__REPLY_POLISH_TRIGGER__', wrappedOnChunk, callId, isNewSession, signal, trace);
                }
                return slcOut;
            } else if (isReplyPolishTrigger) {
                trace.push('SLC (回复润色)');
                const targetText = canvas.task_status.direct_response || canvas.task_status.summary || "";
                return await this.slc.run(text, canvas.context.last_spoken_fragment, targetText, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
            } else {
                trace.push('SLC (直接回复)');
                
                // [V3.6.20] 重要增强：如果用户打断时检测到任务已 READY 但尚未提纯/记录，则强制执行一次 SUMMARIZING
                // 这解决了“用户提问后 AI 直接跳过后台结果”或“播报内容与画布不一致”的问题
                let contextForSlc = canvas.task_status.status === 'READY' ? 
                    (canvas.task_status.direct_response || canvas.task_status.summary || "") : "";

                if (canvas.task_status.status === 'READY' && !canvas.task_status.is_delivered && !canvas.task_status.direct_response) {
                    trace.push('SLE (补齐后台摘要)');
                     const sleSResult = await this.sle.run(
                        managedMessages, text, "任务后台提纯(由用户交互触发)", 
                        this.promptAssembler, callId, canvasSnapshot, 
                        this.canvasManager, () => {}, signal, source, 'SUMMARIZING', taskId
                    ).catch(() => null);
                    if (sleSResult?.output) {
                        contextForSlc = sleSResult.output;
                    }
                }

                // [V3.6.4] 知识路由优化：若命中画布知识，则合并 context
                if (isAnswerInCanvas) {
                    trace.push('SLC (提取画布内容注入)');
                    contextForSlc = `${contextForSlc}\n${canvas.task_status.extended_context || ""}`.trim();
                }
                
                return await this.slc.run(text, canvas.context.last_spoken_fragment, contextForSlc, this.shadow, wrappedOnChunk, signal, managedMessages, isNewSession);
        }
    }
}
