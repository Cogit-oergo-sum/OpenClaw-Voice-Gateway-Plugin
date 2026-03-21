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
    private snapshotPath: string;

    constructor(workspaceRoot: string) {
        this.logDir = path.join(workspaceRoot, 'logs');
        this.snapshotPath = path.join(this.logDir, 'canvas_snapshot.json');
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
                    last_interaction_time: Date.now(),
                    is_busy: false
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
            
            // [V3.4.0] 物理隔离：同步更新全量快照，确保状态持久性
            await this.saveSnapshot();
            
            console.log(`[CanvasLog][${callId}] ${event}: ${JSON.stringify(detail)}`);
        } catch (e) {
            console.error('[CanvasLog] Failed to log event:', e);
        }
    }

    /**
     * [V3.4.0] 全量快照持久化：采用 Write-Full 策略
     */
    private async saveSnapshot() {
        try {
            const data = JSON.stringify(Object.fromEntries(this.canvases), null, 2);
            await fs.promises.writeFile(this.snapshotPath, data, 'utf8');
        } catch (e) {
            console.error('[CanvasManager] Snapshot save failed:', e);
        }
    }

    /**
     * [V3.4.0] 磁盘同步：改为读取轻量级快照文件
     * 彻底解决 JSONL 滚动导致的状态回滚（Double Broadcast Bug）
     */
    async syncCanvasesFromDisk() {
        try {
            if (!fs.existsSync(this.snapshotPath)) return;
            
            const content = await fs.promises.readFile(this.snapshotPath, 'utf8');
            const snapshot = JSON.parse(content);
            
            for (const [callId, diskState] of Object.entries(snapshot) as [string, any][]) {
                if (this.canvases.has(callId)) {
                    const canvas = this.canvases.get(callId)!;
                    
                    if (diskState.task_status?.version > canvas.task_status.version) {
                        // 🚀 发现新版本：说明来自外部系统（如 CLI）的全新任务更新，直接全量同步
                        Object.assign(canvas.task_status, diskState.task_status);
                        Object.assign(canvas.env, diskState.env);
                        Object.assign(canvas.context, diskState.context);
                    } else if (diskState.task_status?.version === canvas.task_status.version) {
                        // 🚀 相同版本：说明是细微状态变更（或来自落后快照的同步）
                        // 核心防御：防止内存状态被过时的磁盘状态覆盖
                        const wasDeliveredInMem = canvas.task_status.is_delivered;
                        const wasBusyInMem = canvas.context.is_busy; 
                        const lastInteractionTimeInMem = canvas.context.last_interaction_time;
                        
                        Object.assign(canvas.task_status, diskState.task_status);
                        if (wasDeliveredInMem) canvas.task_status.is_delivered = true;
                        
                        Object.assign(canvas.env, diskState.env);
                        Object.assign(canvas.context, diskState.context);
                        if (wasBusyInMem) canvas.context.is_busy = true; 
                        // [V3.4.2] 始终保留内存中更新的最后交互时间，防止快照回退导致心跳逻辑波动
                        if (lastInteractionTimeInMem > (canvas.context.last_interaction_time || 0)) {
                            canvas.context.last_interaction_time = lastInteractionTimeInMem;
                        }
                    }
                } else {
                    this.canvases.set(callId, diskState);
                }
            }
        } catch (e) {
            console.error('[CanvasManager] Snapshot sync failed:', e);
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
