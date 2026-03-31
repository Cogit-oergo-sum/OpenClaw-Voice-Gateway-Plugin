import { EventEmitter } from 'events';
import { CanvasManager } from './canvas-manager';
import { AgentOrchestrator } from './agent-orchestrator';

/**
 * [V3.4.0] WatchdogService: 守护进程服务
 * 负责心跳扫描 Canvas、磁盘快照同步以及触发主动播报事件
 */
export class WatchdogService extends EventEmitter {
    private scanTimer: NodeJS.Timeout | null = null;
    private instanceId: string;
    private notifiers: Map<string, (text: string, trace?: string[]) => Promise<void>> = new Map();
    private lastHeartbeatDetails: string = '';
    private lastHeartbeatLogTime: number = 0;

    constructor(
        private canvasManager: CanvasManager,
        instanceId: string,
        private scanInterval: number = 500
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

    start() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        console.log(`[WatchdogService] 🛡️ Started. Interval: ${this.scanInterval}ms`);

        this.scanTimer = setInterval(async () => {
            const canvases = this.canvasManager.getCanvases();
            
            // 打印心跳日志 (状态变更或间隔 20 秒才输出)
            const details = Array.from(canvases.entries()).map(([id, c]) => 
                `${id}(${c.task_status.status},is_del=${c.task_status.is_delivered},sc=${c.task_status.importance_score || 0},notif=${!!this.notifiers.get(id)})`
            ).join(', ');
            
            const currentDetails = `${canvases.size}-${details}`;
            const now = Date.now();
            if (currentDetails !== this.lastHeartbeatDetails || now - this.lastHeartbeatLogTime > 60000) {
                console.log(`[Watchdog][${this.instanceId}] 💓 Heartbeat: ${canvases.size} canvases: [${details || 'none'}]`);
                this.lastHeartbeatDetails = currentDetails;
                this.lastHeartbeatLogTime = now;
            }

            // 执行磁盘同步
            await this.canvasManager.syncCanvasesFromDisk();
            
            // 扫描符合条件的任务触发播报
            for (const [callId, canvas] of canvases.entries()) {
                const status = canvas.task_status;
                const context = canvas.context;
                const score = status.importance_score || 0;

                // [V3.6.22] 触发逻辑重构：精简播报触发，根据重要性分类
                let shouldTrigger = false;

                if (!status.is_delivered) {
                    if (status.status === 'FAILED' || status.status === 'COMPLETED') {
                        // FAILED / COMPLETED：只要未投递且有内容即触发
                        if (status.summary || status.direct_response) {
                            shouldTrigger = true;
                        }
                    } else if (status.status === 'READY') {
                        // READY：新结果就绪，阈值回归至 5.0 以符合 V3.6.5 设计规范（避免低价值干扰）
                        if (score >= 5) {
                            shouldTrigger = true;
                        }
                    } else if (status.status === 'PENDING') {
                        // PENDING：运行中，仅限极高优先级（>= 8）的进度汇报才主动切入
                        if (score >= 8 && (status.summary || status.direct_response)) {
                            shouldTrigger = true;
                        }
                    }
                }

                if (shouldTrigger && this.notifiers.has(callId)) {
                    // [V3.6.25] 防止广播风暴：如果该会话已在处理队列中，则跳过本次触发
                    if (AgentOrchestrator.isLocked(callId)) {
                        continue;
                    }

                    console.log(`[Watchdog] 📣 Triggering broadcast for ${callId} (status: ${status.status}, score: ${score})`);
                    this.emit('trigger', { callId, status, canvas });
                    // 触发后立即更新交互时间，防止紧接着触发闲置逻辑
                    context.last_interaction_time = now;
                }

                // [V3.3.0] 闲置主动问候 (Idle Greeting) 策略
                const idleTime = now - (context.last_interaction_time || now);
                
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

                // 只有 COMPLETED/FAILED/READY 且已投递，才进入闲置扫描
                const isFinished = status.status === 'COMPLETED' || status.status === 'FAILED' || status.status === 'READY';
                if (isFinished && status.is_delivered) {
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
                } else if (status.status === 'PENDING') {
                    context.last_interaction_time = now;
                }
            }
        }, this.scanInterval);
    }

    stop() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        this.notifiers.clear();
    }
}
