import * as fs from 'fs';
import * as path from 'path';
import { CanvasState } from './types';

export class CanvasStorage {
    static async saveSnapshot(snapshotPath: string, canvases: Map<string, CanvasState>) {
        try {
            await fs.promises.writeFile(snapshotPath, JSON.stringify(Object.fromEntries(canvases), null, 2), 'utf8');
        } catch (e) { console.error(e); }
    }

    static async syncFromDisk(snapshotPath: string, canvases: Map<string, CanvasState>) {
        try {
            if (!fs.existsSync(snapshotPath)) return;
            const content = await fs.promises.readFile(snapshotPath, 'utf8');
            if (!content || !content.trim()) return;
            
            let snapshot;
            try {
                snapshot = JSON.parse(content);
            } catch (parseError) {
                console.error(`[CanvasStorage] Failed to parse snapshot JSON: ${snapshotPath}. Data may be corrupted.`);
                return;
            }

            for (const [callId, disk] of Object.entries(snapshot) as any) {
                if (canvases.has(callId)) {
                    const mem = canvases.get(callId)!;
                    if (disk.task_status?.version >= mem.task_status.version) {
                        Object.assign(mem.task_status, disk.task_status);
                        Object.assign(mem.env, disk.env);
                        Object.assign(mem.context, disk.context);
                    }
                } else canvases.set(callId, disk);
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
