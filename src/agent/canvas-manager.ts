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
                tasks: [],
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

    /**
     * [V3.7] 创建新任务并返回其唯一 ID
     */
    createTask(callId: string, name: string): string {
        const canvas = this.getCanvas(callId);
        const taskId = `t_${Math.random().toString(36).substring(2, 6)}`;
        const newTask: any = {
            id: taskId,
            name,
            status: 'PENDING',
            summary: '',
            importance_score: 1.0,
            is_delivered: false,
            created_at: Date.now(),
            updated_at: Date.now(),
            version: Date.now(),
            // [V3.10] 新增字段初始化
            tool_agent_id: undefined,
            pending_questions: []
        };
        canvas.tasks.push(newTask);
        
        // [兼容性] 同步重写旧版 task_status，作为当前活跃任务
        canvas.task_status = { ...newTask, taskId, current_progress: 0 };
        
        console.log(`[CanvasManager][${callId}] 🚀 Task Created: ${name} (ID: ${taskId})`);
        return taskId;
    }

    getTask(callId: string, taskId: string) {
        const canvas = this.getCanvas(callId);
        return canvas.tasks.find(t => t.id === taskId);
    }

    /**
     * [V3.7] 精确更新指定 ID 的 TaskItem
     */
    async updateTask(callId: string, taskId: string, data: any) {
        const canvas = this.getCanvas(callId);
        const task = canvas.tasks.find(t => t.id === taskId);
        
        if (!task) {
            console.warn(`[CanvasManager][${callId}] ⚠️ Attempted to update non-existent task: ${taskId}`);
            // 如果旧代码调用 appendCanvasAudit 且未传 taskId，或者 taskId 找不到，退回到更新活跃任务逻辑
            if (canvas.task_status.taskId === taskId || !taskId) {
                this.legacySyncOldTaskStatus(canvas, data);
            }
            return;
        }

        // 处理 summary 格式兼容
        if (typeof data.summary === 'string') {
            task.summary = data.summary;
            task.direct_response = data.summary;
        } else if (data.summary) {
            task.direct_response = data.summary.direct_response;
            task.extended_context = data.summary.extended_context;
            task.summary = `${data.summary.direct_response}\n${data.summary.extended_context}`;
            if (data.summary.status) task.status = data.summary.status;
            if (typeof data.summary.importance_score === 'number') task.importance_score = data.summary.importance_score;
        }

        // 合并其他字段
        if (data.status && data.status !== task.status) {
            task.status = data.status;
            // [V3.7] 关键状态跃迁时，重置播报标记，确保最终结果必通过 Watchdog 播报
            if (task.status === 'READY' || task.status === 'COMPLETED' || task.status === 'FAILED') {
                task.is_delivered = false;
            }
        }
        if (data.is_delivered !== undefined) task.is_delivered = data.is_delivered;
        if (data.importance_score !== undefined) task.importance_score = data.importance_score;
        if (data.stage) task.stage = data.stage;
        if (data.progress !== undefined) task.progress = data.progress;

        // [V3.10] 新增字段支持
        if (data.direct_response !== undefined) task.direct_response = data.direct_response;
        if (data.extended_context !== undefined) task.extended_context = data.extended_context;
        if (data.tool_agent_id !== undefined) task.tool_agent_id = data.tool_agent_id;
        if (data.pending_questions !== undefined) task.pending_questions = data.pending_questions;
        if (data.completed_at !== undefined) task.completed_at = data.completed_at;
        
        
        task.updated_at = Date.now();
        task.version = Date.now();
        if (task.status === 'COMPLETED' || task.status === 'FAILED') task.completed_at = Date.now();

        // [兼容性] 如果是当前活跃任务，同步到旧版 task_status
        if (canvas.task_status.taskId === taskId) {
            Object.assign(canvas.task_status, { ...task, taskId, current_progress: task.progress || 0 });
        }

        const eventName = (task.status === 'READY' || task.status === 'COMPLETED') ? 'CANVAS_READY' : 'CANVAS_PROGRESS_SYNC';
        await this.logCanvasEvent(callId, eventName, { taskId, summary: task.summary });
    }

    private legacySyncOldTaskStatus(canvas: any, data: any) {
        // 实现旧版平替逻辑
        if (typeof data.summary === 'string') {
            canvas.task_status.summary = data.summary;
        } else if (data.summary) {
             Object.assign(canvas.task_status, data.summary);
        }
        if (data.status) canvas.task_status.status = data.status;
        canvas.task_status.version = Date.now();
    }

    async appendCanvasAudit(callId: string, summary: any, status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED' = 'READY', is_delivered: boolean = false, taskId?: string) {
        const canvas = this.getCanvas(callId);
        const targetId = taskId || canvas.task_status.taskId || '';
        await this.updateTask(callId, targetId, { summary, status, is_delivered });
    }

    async markAsDelivered(callId: string, taskId?: string) {
        const canvas = this.getCanvas(callId);
        const targetId = taskId || canvas.task_status.taskId;
        const task = canvas.tasks.find(t => t.id === targetId);
        
        if (task) {
            task.is_delivered = true;
            task.version = Date.now();
            if (canvas.task_status.taskId === targetId) {
                canvas.task_status.is_delivered = true;
                canvas.task_status.version = task.version;
            }
            await this.logCanvasEvent(callId, 'CANVAS_DELIVERY_CONFIRMED', { taskId: targetId, summary: task.summary });
        } else {
            // 回退到旧逻辑
            canvas.task_status.is_delivered = true;
            canvas.task_status.version = Date.now(); 
            await this.logCanvasEvent(callId, 'CANVAS_DELIVERY_CONFIRMED', { summary: canvas.task_status.summary });
        }
    }

    cancelTask(callId: string, taskId: string) {
        const canvas = this.getCanvas(callId);
        const task = canvas.tasks.find(t => t.id === taskId);
        if (task) {
            task.status = 'CANCELLED';
            task.version = Date.now();
            task.completed_at = Date.now();
            if (canvas.task_status.taskId === taskId) {
                canvas.task_status.status = 'FAILED' as any; // 旧版无 CANCELLED
                canvas.task_status.version = task.version;
            }
            console.log(`[CanvasManager][${callId}] 🛑 Task CANCELLED: ${taskId}`);
        }
    }

    getUndeliveredTasks(callId: string) {
        const canvas = this.getCanvas(callId);
        return canvas.tasks.filter(t => !t.is_delivered && (t.status === 'READY' || t.status === 'COMPLETED' || t.status === 'FAILED'));
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
     * [V3.7] 重置内存中的任务状态，由直接覆盖改为生成新任务
     */
    resetTaskStatus(callId: string): string {
        return this.createTask(callId, '新任务');
    }

    removeCanvas(callId: string) {
        this.canvases.delete(callId);
    }

    async persistAll() {
        await CanvasStorage.saveSnapshot(this.snapshotPath, this.canvases);
    }

    clear() { this.canvases.clear(); }
}
