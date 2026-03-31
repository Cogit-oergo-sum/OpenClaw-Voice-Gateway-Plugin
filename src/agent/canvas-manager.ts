import * as fs from 'fs';
import * as path from 'path';
import { CanvasState } from './types';
import { CanvasStorage } from './canvas-storage';

/**
 * [V3.6.0] CanvasManager: 核心画布管理器 (Slim)
 */
export class CanvasManager {
    private canvases: Map<string, CanvasState> = new Map();
    private logDir: string;
    private snapshotPath: string;

    constructor(workspaceRoot: string) {
        this.logDir = path.join(workspaceRoot, 'logs');
        this.snapshotPath = path.join(this.logDir, 'canvas_snapshot.json');
    }

    getCanvas(callId: string): CanvasState {
        if (!this.canvases.has(callId)) {
            this.canvases.set(callId, {
                env: { time: '', weather: 'Unknown' },
                task_status: { status: 'PENDING', taskId: '', version: Date.now(), current_progress: 0, importance_score: 0, is_delivered: false, summary: '' },
                context: { last_spoken_fragment: '', interrupted: false, last_interaction_time: Date.now(), is_busy: false, idle_trigger_count: 0 }
            });
        }
        return this.canvases.get(callId)!;
    }

    logCanvasEvent(callId: string, event: string, detail: any) {
        try {
            if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
            const entry = { timestamp: new Date().toISOString(), callId, event, detail, state: this.canvases.get(callId) };
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            fs.appendFileSync(logPath, JSON.stringify(entry) + '\n', 'utf8');
            CanvasStorage.saveSnapshot(this.snapshotPath, this.canvases).catch(() => {});
        } catch (e) { console.error(`[CanvasManager] Failed to log event:`, e); }
    }

    async syncCanvasesFromDisk() {
        await CanvasStorage.syncFromDisk(this.snapshotPath, this.canvases);
    }

    async getCanvasEvents(callId: string): Promise<any[]> {
        return CanvasStorage.getEvents(this.logDir, callId);
    }

    async appendCanvasAudit(callId: string, summary: any, status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED' = 'READY', is_delivered: boolean = false, taskId?: string) {
        const canvas = this.getCanvas(callId);
        
        // [V3.6.21] 任务有效性校验：若传入 taskId，必须与当前活跃 taskId 一致，否则判定为“过时状态”丢弃，防止结果 clobber
        if (taskId && canvas.task_status.taskId && taskId !== canvas.task_status.taskId) {
            console.warn(`[CanvasManager][${callId}] ⚠️ Attempted clobber detected. Task ${taskId} is no longer active. Current: ${canvas.task_status.taskId}`);
            return;
        }

        if (typeof summary === 'string') {
            canvas.task_status.summary = summary;
            canvas.task_status.direct_response = summary;
        } else {
            canvas.task_status.direct_response = summary.direct_response;
            canvas.task_status.extended_context = summary.extended_context;
            canvas.task_status.summary = `${summary.direct_response}\n${summary.extended_context}`;
            
            // [V3.6.4] 职责下放：如果摘要携带了状态判定，则以此为准
            if (summary.status) {
                status = summary.status;
            }
            if (typeof summary.importance_score === 'number' && summary.importance_score > 0) {
                canvas.task_status.importance_score = summary.importance_score;
            }
        }
        canvas.task_status.status = status;
        canvas.task_status.version = Date.now();
        canvas.task_status.is_delivered = is_delivered;
        // [V3.6.25] 权重归一化：READY/COMPLETED 结果默认权重提升至 5.0，确保至少能触发 Watchdog 默认播报
        if (!canvas.task_status.importance_score || canvas.task_status.importance_score === 0) {
            canvas.task_status.importance_score = (status === 'READY' || status === 'COMPLETED') ? 5.0 : 1.0;
        }
        
        // 更新日志事件，重命名 legacyRecovery 为更清晰的 READY
        const eventName = (status === 'READY' || status === 'COMPLETED') ? 'CANVAS_READY' : 'CANVAS_PROGRESS_SYNC';
        await this.logCanvasEvent(callId, eventName, { summary });
    }

    async markAsDelivered(callId: string) {
        const canvas = this.getCanvas(callId);
        canvas.task_status.is_delivered = true;
        canvas.task_status.version = Date.now(); 
        await this.logCanvasEvent(callId, 'CANVAS_DELIVERY_CONFIRMED', { summary: canvas.task_status.summary });
    }

    /**
     * [V3.6.8] 持久化会话上下文，确保交互时间等内存状态被写回快照
     */
    async persistContext(callId: string) {
        const canvas = this.getCanvas(callId);
        canvas.task_status.version = Date.now(); // 递增版本号，确保磁盘同步时不会被由于版本相同而判定为过期，从而保护内存中的交互时间
        await CanvasStorage.saveSnapshot(this.snapshotPath, this.canvases);
    }

    /**
     * [V3.6.2] 同步环境上下文 (Time/Weather)
     */
    syncEnvContext(callId: string) {
        const canvas = this.getCanvas(callId);
        canvas.env.time = new Date().toLocaleString('zh-CN', { hour12: false });
        // 此处可扩展天气、位置等实时数据同步
    }

    getCanvases() { return this.canvases; }
    
    /**
     * [V3.6.4] 重置内存中的任务状态，防止旧任务污染新对话
     */
    resetTaskStatus(callId: string): string {
        const canvas = this.getCanvas(callId);
        const taskId = `task-${Date.now()}-${Math.random().toString(36).substring(7)}`;
        canvas.task_status = {
            taskId,
            status: 'PENDING',
            version: Date.now(),
            current_progress: 0,
            importance_score: 0,
            is_delivered: false,
            summary: '',
            direct_response: '',
            extended_context: ''
        };
        console.log(`[CanvasManager][${callId}] 🧹 Memory state purified. New TaskId: ${taskId}`);
        return taskId;
    }

    removeCanvas(callId: string) {
        this.canvases.delete(callId);
    }

    async persistAll() {
        await CanvasStorage.saveSnapshot(this.snapshotPath, this.canvases);
    }

    clear() { this.canvases.clear(); }
}
