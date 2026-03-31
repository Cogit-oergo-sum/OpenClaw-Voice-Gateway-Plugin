import { readWorkspaceFile, appendWorkspaceFile } from '../context/loader';
import { getCurrentCallId } from '../context/ctx';
import * as path from 'path';
import * as fs from 'fs';
import { TextCleaner } from '../utils/text-cleaner';

export interface ShadowState {
    mode: string;
    task_id?: string;
    progress?: string;
    metadata: Record<string, any>;
    lastUpdated: number;
}

/**
 * [V1.6.0] ShadowManager: 负责影子状态的事务级管理
 * 只保留状态管理、WAL 和 Recovery 逻辑，Prompt 组装已移至 PromptAssembler
 */
export class ShadowManager {
    private statePool: Map<string, ShadowState> = new Map();
    private walCount: Map<string, number> = new Map();
    private recoveredCalls: Set<string> = new Set();
    private readonly MAX_WAL_ENTRIES = 1000;

    constructor(private workspaceRoot: string) { }

    /**
     * 获取当前会话的状态 (自动根据 AsyncLocalStorage 隔离)
     */
    getScopedState(): ShadowState {
        const callId = getCurrentCallId();
        if (!callId) {
            return this.getOrCreateState('global-default');
        }
        return this.getOrCreateState(callId);
    }

    getOrCreateState(id: string): ShadowState {
        if (!this.statePool.has(id)) {
            this.statePool.set(id, {
                mode: 'general',
                metadata: {},
                lastUpdated: Date.now()
            });
            this.walCount.set(id, 0);
        }
        return this.statePool.get(id)!;
    }

    /**
     * 原子更新影子状态 (WAL 优先)
     */
    async updateState(patch: Partial<ShadowState>) {
        const callId = getCurrentCallId() || 'global';
        const state = this.getScopedState();

        // 1. WAL: 预写日志追加
        const logEntry = {
            timestamp: Date.now(),
            patch,
            callId
        };
        const walFile = `states/${callId}.wal`;
        await appendWorkspaceFile(this.workspaceRoot, walFile, JSON.stringify(logEntry) + '\n');

        // 2. 更新内存
        if (patch.metadata) {
            state.metadata = { ...state.metadata, ...patch.metadata };
        }
        Object.assign(state, { ...patch, metadata: state.metadata, lastUpdated: Date.now() });

        // 3. 检查 Checkpoint
        const currentCount = (this.walCount.get(callId) || 0) + 1;
        this.walCount.set(callId, currentCount);

        if (currentCount >= this.MAX_WAL_ENTRIES) {
            await this.checkpoint(callId);
        }
    }

    /**
     * Checkpoint: 将状态写回 MD 镜像并截断 WAL
     */
    async checkpoint(callId: string) {
        const state = this.getOrCreateState(callId);
        const fileName = `states/${callId}_shadow.md`;

        const content = `
# Jarvis Shadow State Mirror (${callId})
<!-- SOURCE: WAL_FLUSH -->
<!-- JSON_STATE: ${JSON.stringify(state)} -->

## 状态快照记录
- 最终同步时间: ${new Date().toLocaleString()}
- 当前模式: ${state.mode}
- 待执行任务: ${state.task_id || 'N/A'}

> 本文件由 Fast Agent 自动维护，记录了最近一次的状态 Checkpoint。
`;
        const fullPath = path.join(this.workspaceRoot, fileName);
        await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
        await fs.promises.writeFile(fullPath, content, 'utf8');

        // 清理 WAL 文件
        const walPath = path.join(this.workspaceRoot, `states/${callId}.wal`);
        if (fs.existsSync(walPath)) {
            await fs.promises.unlink(walPath);
        }
        this.walCount.set(callId, 0);

        console.log(`[ShadowManager] Checkpoint finished for ${callId}, WAL truncated.`);
    }

    /**
     * 系统启动时的状态重播 (Recovery)
     */
    async recover(callId: string) {
        if (this.recoveredCalls.has(callId)) return;
        this.recoveredCalls.add(callId);

        const walFile = `states/${callId}.wal`;
        const rawLogs = await readWorkspaceFile(this.workspaceRoot, walFile);
        if (!rawLogs) return;

        const lines = rawLogs.split('\n').filter(l => l.trim());
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                const state = this.getOrCreateState(callId);
                if (entry.patch.metadata) {
                    state.metadata = { ...state.metadata, ...entry.patch.metadata };
                }
                Object.assign(state, { ...entry.patch, metadata: state.metadata, lastUpdated: entry.timestamp });
            } catch (e) {
                console.warn(`[Recovery] Failed to parse WAL line for ${callId}`);
            }
        }
    }

    /**
     * [V3.1.0] 语义脱敏 (Decant)
     */
    static decant(text: string): string {
        return TextCleaner.decant(text);
    }
}

