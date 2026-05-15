import * as fs from 'fs';
import * as path from 'path';
import { ScheduleItem } from './types';

/**
 * [V3.9] CronManager: 持久化定时任务管理器
 */
export class CronManager {
    private schedulePath: string;
    private items: ScheduleItem[] = [];

    constructor(workspaceRoot: string) {
        this.schedulePath = path.join(workspaceRoot, 'memory', 'schedule.json');
        this.load();
    }

    private load() {
        try {
            if (fs.existsSync(this.schedulePath)) {
                const content = fs.readFileSync(this.schedulePath, 'utf8');
                this.items = JSON.parse(content);
            }
        } catch (e) {
            console.error(`[CronManager] Load failed:`, e);
        }
    }

    private save() {
        try {
            const dir = path.dirname(this.schedulePath);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(this.schedulePath, JSON.stringify(this.items, null, 2), 'utf8');
        } catch (e) {
            console.error(`[CronManager] Save failed:`, e);
        }
    }

    addSchedule(item: Omit<ScheduleItem, 'id' | 'created_at'>) {
        const newItem: ScheduleItem = {
            ...item,
            id: `s_${Math.random().toString(36).substring(7)}`,
            created_at: Date.now()
        };
        this.items.push(newItem);
        this.save();
        console.log(`[CronManager] ➕ Scheduled: ${newItem.task_name} (${newItem.cron || newItem.time_point})`);
        return newItem.id;
    }

    removeSchedule(id: string) {
        this.items = this.items.filter(i => i.id !== id);
        this.save();
    }

    getDueItems(): ScheduleItem[] {
        const now = Date.now();
        const due: ScheduleItem[] = [];
        const remaining: ScheduleItem[] = [];

        for (const item of this.items) {
            let isDue = false;
            
            if (item.time_point && now >= item.time_point) {
                isDue = true;
            } else if (item.cron) {
                // 极简实现：仅支持分钟级精确匹配（本 Demo 使用这种方式）
                // 实际生产应使用 cron-parser
                isDue = this.checkCronMatch(item.cron, now);
            }

            if (isDue) {
                due.push(item);
                // 如果是单次任务，则移除；如果是周期性（cron），则保留
                if (!item.cron) {
                    continue; 
                }
            }
            remaining.push(item);
        }

        if (due.length > 0) {
            this.items = remaining;
            this.save();
        }
        return due;
    }

    private checkCronMatch(cron: string, timestamp: number): boolean {
        // [V3.9] 极简 Cron 适配器：支持 "0 8 * * *" 这种格式
        const date = new Date(timestamp);
        const [min, hour, dom, mon, dow] = cron.split(' ');
        
        const match = (val: number, pattern: string) => pattern === '*' || parseInt(pattern) === val;

        return match(date.getMinutes(), min) && 
               match(date.getHours(), hour) &&
               match(date.getDate(), dom) &&
               match(date.getMonth() + 1, mon) &&
               match(date.getDay(), dow);
    }
}
