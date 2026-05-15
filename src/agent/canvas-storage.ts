import * as fs from 'fs';
import * as path from 'path';
import { CanvasState } from './types';

export class CanvasStorage {
    private static saveQueue: Promise<void> = Promise.resolve();

    static async saveSnapshot(snapshotPath: string, canvases: Map<string, CanvasState>) {
        const data = JSON.stringify(Object.fromEntries(canvases), null, 2);
        this.saveQueue = this.saveQueue.then(async () => {
            try {
                await fs.promises.writeFile(snapshotPath, data, 'utf8');
            } catch (e) {
                console.error(`[CanvasStorage] Save failed:`, e);
            }
        });
        return this.saveQueue;
    }

    static async syncFromDisk(snapshotPath: string, canvases: Map<string, CanvasState>) {
        try {
            if (!fs.existsSync(snapshotPath)) return;
            const content = await fs.promises.readFile(snapshotPath, 'utf8');
            if (!content || !content.trim()) return;
            
            let snapshot;
            try {
                snapshot = JSON.parse(content);
            } catch (parseError: any) {
                console.error(`[CanvasStorage] Failed to parse snapshot JSON: ${snapshotPath}. Error: ${parseError.message}. Data may be corrupted.`);
                return;
            }

            for (const [callId, disk] of Object.entries(snapshot) as [string, any]) {
                if (canvases.has(callId)) {
                    const mem = canvases.get(callId)!;
                    
                    // [Migration] 如果磁盘中没有 tasks[] 但有 task_status，自动迁移
                    if (!disk.tasks && disk.task_status) {
                        disk.tasks = [{
                            ...disk.task_status,
                            id: disk.task_status.taskId || `legacy_${Date.now()}`,
                            name: 'Legacy Task',
                            created_at: Date.now(),
                            version: disk.task_status.version
                        }];
                    }

                    // 比较版本并同步
                    const diskVersion = disk.tasks?.[disk.tasks.length - 1]?.version || disk.task_status?.version || 0;
                    const memVersion = mem.tasks?.[mem.tasks.length - 1]?.version || mem.task_status?.version || 0;

                    if (diskVersion >= memVersion) {
                        if (disk.tasks) mem.tasks = disk.tasks;
                        if (disk.task_status) Object.assign(mem.task_status, disk.task_status);
                        Object.assign(mem.env, disk.env);
                        Object.assign(mem.context, disk.context);
                    }
                } else {
                    // [Migration] 同样处理新设置的 canvas
                    if (!disk.tasks && disk.task_status) {
                        disk.tasks = [{
                            ...disk.task_status,
                            id: disk.task_status.taskId || `legacy_${Date.now()}`,
                            name: 'Legacy Task',
                            created_at: Date.now(),
                            version: disk.task_status.version
                        }];
                    }
                    canvases.set(callId, disk);
                }
            }
        } catch (e) { console.error(e); }
    }

    static async getEvents(logDir: string, callId: string): Promise<any[]> {
        try {
            const p = path.join(logDir, 'canvas.jsonl');
            if (!fs.existsSync(p)) return [];
            const raw = await fs.promises.readFile(p, 'utf8');
            return raw.trim().split('\n')
                .map(l => {
                    try { return JSON.parse(l); } catch (e) { return null; }
                })
                .filter(e => e && e.callId === callId);
        } catch (e) { return []; }
    }
}
