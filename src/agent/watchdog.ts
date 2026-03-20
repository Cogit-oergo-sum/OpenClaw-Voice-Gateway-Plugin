import { EventEmitter } from 'events';
import { CanvasManager } from './canvas-manager';

/**
 * [V3.2.0] WatchdogService: 守护进程服务
 * 负责心跳扫描 Canvas、磁盘同步以及触发主动播报事件
 */
export class WatchdogService extends EventEmitter {
    private scanTimer: NodeJS.Timeout | null = null;
    private instanceId: string;
    private notifiers: Map<string, (text: string, trace?: string[]) => Promise<void>> = new Map();

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

    getNotifier(callId: string) {
        return this.notifiers.get(callId);
    }

    start() {
        if (this.scanTimer) clearInterval(this.scanTimer);
        console.log(`[WatchdogService] 🛡️ Started. Interval: ${this.scanInterval}ms`);

        this.scanTimer = setInterval(async () => {
            const canvases = this.canvasManager.getCanvases();
            
            // 打印心跳日志
            const details = Array.from(canvases.entries()).map(([id, c]) => 
                `${id}(${c.task_status.status},is_del=${c.task_status.is_delivered},notif=${!!this.notifiers.get(id)})`
            ).join(', ');
            console.log(`[Watchdog][${this.instanceId}] 💓 Heartbeat: ${canvases.size} canvases: [${details || 'none'}]`);

            // 执行磁盘同步
            await this.canvasManager.syncCanvasesFromDisk();

            const now = Date.now();
            
            // 扫描符合 READY 且未投递的任务
            for (const [callId, canvas] of canvases.entries()) {
                const status = canvas.task_status;
                const context = canvas.context;

                if (status.status === 'READY' && !status.is_delivered) {
                    if (status.importance_score < 0.7) continue;

                    // 这里的 notifier 检查很重要
                    if (this.notifiers.has(callId)) {
                        // 触发事件给订阅者（通常是 FastAgentV3）
                        // 订阅者负责调用 process() 并处理 is_delivered 的标记
                        this.emit('trigger', { callId, status, canvas });
                    }
                }

                // [V3.3.0] 闲置主动问候 (Idle Greeting) 策略
                const idleTime = now - (context.last_interaction_time || now);
                
                if (status.status === 'READY' && status.is_delivered) {
                    if (idleTime > 15000) {
                        console.log(`[Watchdog][${this.instanceId}] ⏳ Idle Trigger: callId=${callId}, idleTime=${idleTime}ms, notifRegistered=${this.notifiers.has(callId)}`);
                        // 🚀 [V3.3.2] 触发问候并重置计数，以支持每隔 15 秒询问一次
                        context.last_interaction_time = now;
                        if (this.notifiers.has(callId)) {
                            console.log(`[Watchdog][${this.instanceId}] ⏳ User idle for 15s, triggering greeting for ${callId}`);
                            this.emit('idle_trigger', { callId, canvas });
                        }
                    }
                } else if (status.status === 'PENDING') {
                    // 任务进行中，持续重置交互时间，防止在任务期间误触发 idle greeting
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
