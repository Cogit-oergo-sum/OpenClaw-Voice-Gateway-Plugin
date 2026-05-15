import * as path from 'path';
import * as fs from 'fs';
import { appendWorkspaceFile } from '../context/loader';
import { TextCleaner } from '../utils/text-cleaner';
import { MemorySyncManager, DialogueEntry } from './memory-sync';

/**
 * [V3.3.0] DialogueMemory: 独立负责对话历史的持久化与检索
 * 从 ShadowManager 中剥离，专注 O-WAL (Object Write Ahead Log) 与会话上下文还原
 * [V4.0] 支持 MemorySyncPlugin 插件，可双向同步对话记录到外部系统
 */
export class DialogueMemory {
    private memorySyncManager: MemorySyncManager | null = null;

    constructor(private workspaceRoot: string) { }

    /**
     * [V4.0] 设置 MemorySyncManager
     * 允许注入记忆同步管理器，支持与外部系统同步
     */
    setMemorySyncManager(manager: MemorySyncManager): void {
        this.memorySyncManager = manager;
        console.log(`[DialogueMemory] MemorySyncManager 已注入。`);
    }

    /**
     * [V4.0] 获取 MemorySyncManager
     */
    getMemorySyncManager(): MemorySyncManager | null {
        return this.memorySyncManager;
    }

    /**
     * 将对话记录持久化到 memory/ 目录
     * [V4.0] 同时同步到 MemorySyncPlugin（如果已配置）
     */
    async logDialogue(callId: string, role: 'user' | 'assistant', content: string): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const logDir = path.join(this.workspaceRoot, 'memory');
        const logFile = `memory/${date}.jsonl`;

        if (!fs.existsSync(logDir)) {
            await fs.promises.mkdir(logDir, { recursive: true });
        }

        const entry: DialogueEntry = {
            timestamp: new Date().toISOString(),
            callId,
            role,
            content
        };

        // 写入本地文件
        await appendWorkspaceFile(this.workspaceRoot, logFile, JSON.stringify(entry) + '\n');

        // [V4.0] 同步到 MemorySyncPlugin
        if (this.memorySyncManager) {
            await this.memorySyncManager.syncDialogue(callId, entry);
        }
    }

    /**
     * 获取结构化的对话历史
     */
    async getHistoryMessages(callId: string, limit: number = 10): Promise<Array<{ role: string; content: string }>> {
        try {
            const date = new Date().toISOString().split('T')[0];
            const logFile = path.join(this.workspaceRoot, `memory/${date}.jsonl`);
            if (!fs.existsSync(logFile)) return [];

            const content = await fs.promises.readFile(logFile, 'utf8');
            const lines = content.trim().split('\n');
            const sessionLines = lines
                .map(l => {
                    try { return JSON.parse(l); } catch (e) { return null; }
                })
                .filter(l => l && !l.event && (callId === 'global' || l.callId === callId))
                .slice(-limit);

            return sessionLines.map(l => ({
                role: l.role,
                content: TextCleaner.decant(l.content)
            }));
        } catch (e) {
            console.error('[DialogueMemory] getHistoryMessages error:', e);
            return [];
        }
    }

    /**
     * 获取原始对话流，不带信封包装
     * 支持 global 模式：不限制 callId，用于入站加载
     */
    async getRecentDialogueContextRaw(limit: number = 5, callIdFilter: string | null = null): Promise<string> {
        const messages = await this.getHistoryMessages(callIdFilter || 'global', limit);
        return messages.map(m => {
            const roleStr = m.role === 'user' ? '用户' : '助理';
            return `${roleStr}: ${m.content}`;
        }).join('\n');
    }

    /**
     * 获取最近的对话背景摘要，用于注入到 CLI 调用中
     * 改造后：显式传入 callId 和 state 信息
     */
    async getRecentDialogueContext(callId: string, stateMode: string, taskId?: string, limit: number = 3): Promise<string> {
        try {
            const date = new Date().toISOString().split('T')[0];
            const logFile = path.join(this.workspaceRoot, `memory/${date}.jsonl`);
            if (!fs.existsSync(logFile)) return "";

            const content = await fs.promises.readFile(logFile, 'utf8');
            const lines = content.trim().split('\n');
            const sessionLines = lines
                .map(l => {
                    try { return JSON.parse(l); } catch (e) { return null; }
                })
                .filter(l => l && l.callId === callId)
                .slice(-limit);

            const summary = sessionLines.map(l => {
                const cleanContent = TextCleaner.decant(l.content);
                return `${l.role === 'user' ? '用户' : '助理'}: ${cleanContent}`;
            }).join(' | ');

            return `[${summary}][当前状态: ${stateMode}${taskId ? `, 任务ID: ${taskId}` : ''}] `;
        } catch (e) {
            console.error('[DialogueMemory] Failed to get recent context:', e);
            return "";
        }
    }

    /**
     * [V3.7] 记录结构化事件 (如 TASK_ARCHIVED)
     * 写入格式: { timestamp: number, callId, event: eventType, payload }
     */
    async logEvent(callId: string, eventType: string, payload: any): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const logDir = path.join(this.workspaceRoot, 'memory');
        const logFile = `memory/${date}.jsonl`;

        if (!fs.existsSync(logDir)) {
            await fs.promises.mkdir(logDir, { recursive: true });
        }

        const entry: DialogueEntry = {
            timestamp: Date.now(),
            callId,
            role: 'assistant', // 事件记录默认使用 assistant 角色
            content: '', // 事件记录无内容
            event: eventType,
            payload
        };

        await appendWorkspaceFile(this.workspaceRoot, logFile, JSON.stringify(entry) + '\n');

        // [V4.0] 事件通常不需要同步到外部系统，所以不调用 syncDialogue
    }

    /**
     * [V3.7] 从 .jsonl 中筛选最近归档的任务记录
     * 用于 Agent 2B 的 PromptAssembler 注入
     */
    async getRecentArchivedTasks(limit: number = 5): Promise<Array<{ id: string; name: string; summary: string; archived_at: number }>> {
        try {
            const date = new Date().toISOString().split('T')[0];
            const logFile = path.join(this.workspaceRoot, `memory/${date}.jsonl`);
            if (!fs.existsSync(logFile)) return [];

            const content = await fs.promises.readFile(logFile, 'utf8');
            const lines = content.trim().split('\n');
            const archivedTasks = lines
                .map(l => {
                    try { return JSON.parse(l); } catch (e) { return null; }
                })
                .filter(l => l && l.event === 'TASK_ARCHIVED')
                .reverse()
                .slice(0, limit)
                .map(l => ({
                    id: l.payload.id,
                    name: l.payload.name,
                    summary: l.payload.summary,
                    archived_at: l.timestamp
                }));

            return archivedTasks;
        } catch (e) {
            console.error('[DialogueMemory] getRecentArchivedTasks error:', e);
            return [];
        }
    }

    /**
     * [V4.0] 从外部系统加载记忆（通过 MemorySyncPlugin）
     * 合入到本地 memory 目录
     */
    async loadExternalMemory(): Promise<void> {
        if (!this.memorySyncManager) {
            return;
        }

        const results = await this.memorySyncManager.loadMemory(this.workspaceRoot);

        for (const result of results) {
            if (result.dialogue.length > 0) {
                // 合入对话记录到本地 memory
                const date = new Date().toISOString().split('T')[0];
                const logFile = `memory/${date}.jsonl`;
                const entriesStr = result.dialogue.map(e => JSON.stringify(e)).join('\n') + '\n';
                await appendWorkspaceFile(this.workspaceRoot, logFile, entriesStr);
                console.log(`[DialogueMemory] Loaded ${result.dialogue.length} entries from ${result.source}`);
            }

            // 人设文件的处理由 PromptAssembler 负责
        }
    }
}