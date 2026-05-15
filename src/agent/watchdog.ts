import { EventEmitter } from 'events';
import { CanvasManager } from './canvas-manager';
import { AgentOrchestrator } from './agent-orchestrator';
import { DialogueMemory } from './dialogue-memory';
import { CronManager } from './cron-manager';
import { TaskItem } from './types';
import { TaskImportanceManager } from './task-importance-config';

/**
 * [V3.4.0] WatchdogService: 守护进程服务
 * 负责心跳扫描 Canvas、磁盘快照同步以及触发主动播报事件
 * [V3.11] 支持 TaskImportanceManager 动态阈值配置
 */
export class WatchdogService extends EventEmitter {
    private scanTimer: NodeJS.Timeout | null = null;
    private instanceId: string;
    private notifiers: Map<string, (text: string, trace?: string[]) => Promise<void>> = new Map();
    private lastHeartbeatDetails: string = '';
    private lastHeartbeatLogTime: number = 0;

    constructor(
        private canvasManager: CanvasManager,
        private dialogueMemory: DialogueMemory,
        private cronManager: CronManager,
        instanceId: string,
        private scanInterval: number = 500,
        private taskImportance?: TaskImportanceManager // [V3.11] 任务重要性配置管理
    ) {
        super();
        this.instanceId = instanceId;
    }

    /**
     * 注册特定会话的通知器（由主 Agent 在 process 时注入）
     */
    registerNotifier(callId: string, notifier: (text: string, trace?: string[]) => Promise<void>) {
        this.notifiers.set(callId, notifier);
    }

    unregisterNotifier(callId: string) {
        this.notifiers.delete(callId);
    }

    getNotifier(callId: string) {
        return this.notifiers.get(callId);
    }

    stop() {
        if (this.scanTimer) {
            clearInterval(this.scanTimer);
            this.scanTimer = null;
        }
        console.log(`[WatchdogService] 🛡️ Stopped.`);
    }

    start() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        console.log(`[WatchdogService] 🛡️ Started. Interval: ${this.scanInterval}ms`);

        this.scanTimer = setInterval(async () => {
            const canvases = this.canvasManager.getCanvases();
            const now = Date.now();
            const TTL_2_MINUTES = 2 * 60 * 1000;
            
            // 打印心跳日志 (状态变更或间隔 20 秒才输出)
            const details = Array.from(canvases.entries()).map(([id, c]) => {
                const tasksInfo = c.tasks.length > 0 
                    ? c.tasks.map(t => `${t.id}(${t.status},del=${t.is_delivered},sc=${t.importance_score})`).join('|')
                    : `legacy(${c.task_status.status},sc=${c.task_status.importance_score})`;
                return `${id}:[${tasksInfo}]`;
            }).join(', ');
            
            const currentDetails = `${canvases.size}-${details}`;
            if (currentDetails !== this.lastHeartbeatDetails || now - this.lastHeartbeatLogTime > 60000) {
                console.log(`[Watchdog][${this.instanceId}] 💓 Heartbeat: ${canvases.size} canvases: [${details || 'none'}]`);
                this.lastHeartbeatDetails = currentDetails;
                this.lastHeartbeatLogTime = now;
            }

            // 执行磁盘同步
            await this.canvasManager.syncCanvasesFromDisk();

            // [V3.9] 处理定时任务执行触发
            const dueTasks = this.cronManager.getDueItems();
            for (const item of dueTasks) {
                console.log(`[Watchdog] ⏰ Triggering scheduled task: ${item.task_name}`);
                const taskId = this.canvasManager.createTask(item.callId, item.task_name);
                await this.canvasManager.updateTask(item.callId, taskId, {
                    summary: `⏰ [定时触发] ${item.query}`,
                    importance_score: 10,
                    is_delivered: false // 标记为未投递，这样 Watchdog 稍后会触发播报通知用户开始执行
                });
                // 触发 Orchestrator 逻辑由 FastAgentV3 感应 Canvas 变化执行 (或者这里直接 emit 事件)
                this.emit('SCHEDULE_TRIGGERED', { callId: item.callId, taskId, query: item.query });
            }
            
            for (const [callId, canvas] of canvases.entries()) {
                if (AgentOrchestrator.isLocked(callId)) continue;
                
                const pendingBroadcasts: TaskItem[] = [];
                const context = canvas.context;

                let gcOccurred = false;
                // [V3.7] 嵌套双循环：外层 callId -> 内层 tasks[] (倒序扫描以便 GC 删除)
                for (let i = canvas.tasks.length - 1; i >= 0; i--) {
                    const task = canvas.tasks[i];

                    // === 1. 聚合播报判定 ===
                    // [V3.11] 使用动态阈值配置
                    const readyThreshold = this.taskImportance?.getThreshold('READY') || 5;
                    const pendingThreshold = this.taskImportance?.getThreshold('PENDING') || 8;

                    let shouldBroadcast = false;
                    if ((task.status === 'COMPLETED' || task.status === 'FAILED') && !task.is_delivered && (task.summary || task.direct_response)) {
                        shouldBroadcast = true;
                    } else if (task.status === 'READY' && (task.importance_score || 0) >= readyThreshold && !task.is_delivered) {
                        shouldBroadcast = true;
                    } else if (task.status === 'PENDING' && (task.importance_score || 0) >= pendingThreshold && !task.is_delivered) {
                        shouldBroadcast = true;
                    }

                    if (shouldBroadcast) {
                        pendingBroadcasts.push(task);
                    }

                    // === 2. GC 归档判定 (TTL 2 分钟) ===
                    if ((task.status === 'COMPLETED' || task.status === 'FAILED') && task.is_delivered) {
                        if (task.completed_at && (now - task.completed_at > TTL_2_MINUTES)) {
                            console.log(`[Watchdog] 📦 Archiving task ${task.id} for session ${callId}`);
                            await this.dialogueMemory.logEvent(callId, 'TASK_ARCHIVED', { 
                                id: task.id, 
                                name: task.name, 
                                summary: task.summary 
                            });
                            canvas.tasks.splice(i, 1);
                            gcOccurred = true;
                        }
                    }
                }

                // 如果发生了 GC，立即同步到磁盘快照
                if (gcOccurred) {
                    await this.canvasManager.persistContext(callId).catch(() => {});
                }

                // 执行聚合播报
                if (pendingBroadcasts.length > 0 && this.notifiers.has(callId)) {
                    console.log(`[Watchdog] 📣 Triggering aggregate broadcast for ${callId} (${pendingBroadcasts.length} tasks)`);
                    
                    this.emit('trigger', { callId, tasks: pendingBroadcasts, canvas });
                    context.last_interaction_time = now;
                    continue; 
                }


                // [V3.3.0] 闲置主动问候 (Idle Greeting) 策略
                if (context.is_busy) {
                    const elapsedSinceInteraction = now - (context.last_interaction_time || now);
                    if (elapsedSinceInteraction > 90000) { 
                        console.warn(`[Watchdog][${this.instanceId}] 🚨 Session ${callId} stuck in BUSY for ${Math.round(elapsedSinceInteraction/1000)}s! Force-recovering.`);
                        context.is_busy = false;
                        context.last_interaction_time = now;
                        await this.canvasManager.persistContext(callId).catch(() => {});
                    }
                    continue;
                }

                // 只有所有活跃任务均已投递且处于终态，才进入闲置扫描
                const isAllFinished = canvas.tasks.length > 0 && canvas.tasks.every(t => 
                    (t.status === 'COMPLETED' || t.status === 'FAILED' || t.status === 'READY') && t.is_delivered
                );

                if (isAllFinished) {
                    const idleTime = now - (context.last_interaction_time || now);
                    const isTextChat = callId.startsWith('text-chat-');
                    const threshold = isTextChat ? 60000 : 15000;

                    if (idleTime > threshold) { 
                        if (!AgentOrchestrator.isLocked(callId) && this.notifiers.has(callId) && (context.idle_trigger_count || 0) < 1) {
                            console.log(`[Watchdog][${this.instanceId}] ⏳ Session ${callId} idle for ${Math.round(idleTime/1000)}s, triggering first greeting.`);
                            context.last_interaction_time = now;
                            context.idle_trigger_count = (context.idle_trigger_count || 0) + 1;
                            await this.canvasManager.persistContext(callId).catch(() => {});
                            this.emit('idle_trigger', { callId, canvas });
                        }
                    }
                }
            }
        }, this.scanInterval);
    }
}
