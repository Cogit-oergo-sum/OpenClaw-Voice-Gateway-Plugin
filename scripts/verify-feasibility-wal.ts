/**
 * 可行性验证脚本：Shadow MD 定时更新、WAL 事务与会话隔离
 */
import { AsyncLocalStorage } from 'async_hooks';
import * as fs from 'fs';
import * as path from 'path';

// 1. 物理隔离：会话上下文沙箱
const callStorage = new AsyncLocalStorage<string>();

class ShadowManager {
    private state: Record<string, any> = {};
    private walPath: string;
    private mdPath: string;
    private writeQueue: Promise<void> = Promise.resolve();

    constructor(callId: string) {
        const baseDir = path.join(process.cwd(), 'tmp/debug_shadow');
        if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir, { recursive: true });
        this.walPath = path.join(baseDir, `${callId}.wal`);
        this.mdPath = path.join(baseDir, `${callId}.md`);
    }

    // 模拟原子更新：WAL 优先
    async update(event: Record<string, any>) {
        const callId = callStorage.getStore();
        
        // 排队进入【独占写队列】
        this.writeQueue = this.writeQueue.then(async () => {
            // A. WAL 写入 (物理保存变更)
            const logEntry = JSON.stringify({ t: Date.now(), ...event }) + '\n';
            fs.appendFileSync(this.walPath, logEntry);

            // B. 内存快照更新 (乐观执行)
            this.state = { ...this.state, ...event };
            
            // 模拟 10ms I/O 开销
            await new Promise(r => setTimeout(r, 10));
            console.log(`[Call-${callId}] WAL & Memory Atomic Update:`, event);
        });

        return this.writeQueue;
    }

    // 模拟从崩溃中回放 WAL
    replay() {
        if (!fs.existsSync(this.walPath)) return;
        const logs = fs.readFileSync(this.walPath, 'utf-8').trim().split('\n');
        logs.forEach(log => {
            const entry = JSON.parse(log);
            this.state = { ...this.state, ...entry };
        });
        console.log(`[RECOVERY] Replayed ${logs.length} events. State recovered.`);
    }

    getState() { return this.state; }
}

// 模拟高并发压力测试
async function simulateHighConcurrency() {
    const managers: Record<string, ShadowManager> = {};

    const job = async (id: string, updateVal: string) => {
        return callStorage.run(id, async () => {
            if (!managers[id]) managers[id] = new ShadowManager(id);
            await managers[id].update({ game_status: updateVal });
        });
    };

    console.log("🚀 开始并发状态更新测试...");
    await Promise.all([
        job('CALL_A', 'PLAYING_ROUND_1'),
        job('CALL_B', 'WAITING'),
        job('CALL_A', 'PLAYING_ROUND_2'), // CALL_A 的连续操作应按序执行且不干扰 CALL_B
        job('CALL_B', 'PLAYING_ROUND_1'),
    ]);

    // 验证崩溃恢复
    console.log("\n💥 模拟进程崩溃重启，回放 WAL...");
    const recoveryA = new ShadowManager('CALL_A');
    recoveryA.replay();
    
    if (recoveryA.getState().game_status === 'PLAYING_ROUND_2') {
        console.log("✅ 验证成功：WAL 成功恢复了正确的最终状态！");
    } else {
        console.error("❌ 验证失败：状态不一致！");
    }
}

simulateHighConcurrency().catch(console.error);
