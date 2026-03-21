import * as path from 'path';
import * as fs from 'fs';
import { appendWorkspaceFile } from '../context/loader';
import { TextCleaner } from '../utils/text-cleaner';

/**
 * [V3.3.0] DialogueMemory: 独立负责对话历史的持久化与检索
 * 从 ShadowManager 中剥离，专注 O-WAL (Object Write Ahead Log) 与会话上下文还原
 */
export class DialogueMemory {
    constructor(private workspaceRoot: string) { }

    /**
     * 将对话记录持久化到 memory/ 目录，供 OpenClaw 主 Agent 感知
     */
    async logDialogue(callId: string, role: 'user' | 'assistant', content: string): Promise<void> {
        const date = new Date().toISOString().split('T')[0];
        const logDir = path.join(this.workspaceRoot, 'memory');
        const logFile = `memory/${date}.jsonl`;

        if (!fs.existsSync(logDir)) {
            await fs.promises.mkdir(logDir, { recursive: true });
        }

        const entry = {
            timestamp: new Date().toISOString(),
            callId,
            role,
            content
        };
        await appendWorkspaceFile(this.workspaceRoot, logFile, JSON.stringify(entry) + '\n');
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
                .filter(l => l && (callId === 'global' || l.callId === callId))
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
}
