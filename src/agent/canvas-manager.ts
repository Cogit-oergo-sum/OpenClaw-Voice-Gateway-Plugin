import * as fs from 'fs';
import * as path from 'path';
import { CanvasState } from './types';

/**
 * [V3.2.0] CanvasManager: 核心画布管理器
 * 负责状态内存存储、审计日志记录、磁盘状态同步
 */
export class CanvasManager {
    private canvases: Map<string, CanvasState> = new Map();
    private logDir: string;

    constructor(workspaceRoot: string) {
        this.logDir = path.join(workspaceRoot, 'logs');
    }

    getCanvases(): Map<string, CanvasState> {
        return this.canvases;
    }

    getCanvas(callId: string): CanvasState {
        if (!this.canvases.has(callId)) {
            const canvas: CanvasState = {
                env: { 
                    time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }), 
                    weather: 'Unknown' 
                },
                task_status: {
                    status: 'PENDING',
                    version: Date.now(),
                    current_progress: 0,
                    importance_score: 0,
                    is_delivered: false,
                    summary: '',
                    extracted_data: ''
                },
                context: {
                    last_spoken_fragment: '',
                    interrupted: false,
                    last_interaction_time: Date.now()
                }
            };
            this.canvases.set(callId, canvas);
            this.logCanvasEvent(callId, 'CANVAS_INIT', {});
        }
        return this.canvases.get(callId)!;
    }

    /**
     * [V3.1.6] Canvas 审计日志：记录状态机所有流转轨迹
     */
    async logCanvasEvent(callId: string, event: string, detail: any) {
        try {
            if (!fs.existsSync(this.logDir)) fs.mkdirSync(this.logDir, { recursive: true });
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            const entry = {
                timestamp: new Date().toISOString(),
                callId,
                event,
                detail,
                state: this.canvases.get(callId)
            };
            await fs.promises.appendFile(logPath, JSON.stringify(entry) + '\n');
            console.log(`[CanvasLog][${callId}] ${event}: ${JSON.stringify(detail)}`);
        } catch (e) {
            console.error('[CanvasLog] Failed to log event:', e);
        }
    }

    /**
     * [V3.3.6] 磁盘同步：从审计日志中恢复最新的画布状态
     * 解决外部系统（CLI, Timers）更新状态后，本进程内存不感知的问题
     */
    async syncCanvasesFromDisk() {
        try {
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            if (!fs.existsSync(logPath)) return;
            
            const content = await fs.promises.readFile(logPath, 'utf8');
            const lines = content.trim().split('\n').slice(-100); // 仅扫描最近 100 条变动以平衡性能
            
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.callId && entry.state?.task_status && this.canvases.has(entry.callId)) {
                        const canvas = this.canvases.get(entry.callId)!;
                        if (entry.state.task_status.version >= canvas.task_status.version) {
                           // 🚀 防止回滚：如果内存中已投递，不被磁盘的老状态覆盖为未投递
                           const wasDelivered = canvas.task_status.is_delivered;
                           if (canvas.task_status.status !== entry.state.task_status.status) {
                               console.log(`[Watchdog] 🔄 Session ${entry.callId} state synced: ${canvas.task_status.status} -> ${entry.state.task_status.status}`);
                           }
                           Object.assign(canvas.task_status, entry.state.task_status);
                           if (wasDelivered) canvas.task_status.is_delivered = true;
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {
            console.error('[CanvasManager] Disk sync failed:', e);
        }
    }

    /**
     * [V3.3.7] 获取特定会话的所有审计日志事件
     */
    async getCanvasEvents(callId: string): Promise<any[]> {
        try {
            const logPath = path.join(this.logDir, 'canvas.jsonl');
            if (!fs.existsSync(logPath)) return [];
            
            const content = await fs.promises.readFile(logPath, 'utf8');
            const lines = content.trim().split('\n');
            const events: any[] = [];
            
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (entry.callId === callId) {
                        events.push(entry);
                    }
                } catch (e) {}
            }
            return events;
        } catch (e) {
            console.error('[CanvasManager] Failed to read events:', e);
            return [];
        }
    }

    clear() {
        this.canvases.clear();
    }
}
