import { readWorkspaceFile, writeWorkspaceJson, appendWorkspaceFile } from '../context/loader';
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
 * 支持: AsyncLocalStorage 隔离, WAL 追加日志, Checkpoint 快照合并
 */
export class ShadowManager {
    // 内存实例池
    private statePool: Map<string, ShadowState> = new Map();
    private walCount: Map<string, number> = new Map();
    private recoveredCalls: Set<string> = new Set();
    private readonly MAX_WAL_ENTRIES = 1000;

    constructor(private workspaceRoot: string) { }

    /**
     * 获取当前会话的状态 (自动根据 AsyncLocalStorage 隔离)
     */
    private getScopedState(): ShadowState {
        const callId = getCurrentCallId();
        if (!callId) {
            // Fallback to a global/default state if no context found
            return this.getOrCreateState('global-default');
        }
        return this.getOrCreateState(callId);
    }

    private getOrCreateState(id: string): ShadowState {
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
     * 初始化：从持久化存储加载并构建 Prompt
     * [V3.2.0] isNewSession: 如果是首次连接，则从全局记忆库（跨会话）加载背景
     */
    async getContextPrompts(isNewSession: boolean = false): Promise<string> {
        const callId = getCurrentCallId() || 'global';
        const state = this.getScopedState();

        const soulMd = await readWorkspaceFile(this.workspaceRoot, 'soul.md') || '';
        const userMd = await readWorkspaceFile(this.workspaceRoot, 'user.md') || '';
        const agentsMd = await readWorkspaceFile(this.workspaceRoot, 'AGENTS.md') || '';
        const identityMd = await readWorkspaceFile(this.workspaceRoot, 'IDENTITY.md') || '';
        const memoryMd = await readWorkspaceFile(this.workspaceRoot, 'memory.md') || '';

        // [V1.9.0] 提取最近 5 轮对话作为短期记忆增强
        // [V3.2.0] 入站加载：如果是新 Session，不限制 CallId，拉取全局最后几轮
        const recentHistory = await this.getRecentDialogueContextRaw(20, isNewSession ? null : callId);

        return `
[人设与指南 (Persona & Agents Guidelines)]
${soulMd}
${agentsMd}
${identityMd}

[用户画像 (User Profile)]
${userMd}

[核心长期记忆 (Long-term Memory)]
${memoryMd}

[短期会话记录 (Recent Conversation)${isNewSession ? ' (来自全局同步记忆)' : ''}]
${recentHistory || '暂无历史记录'}

[当前影子状态 (Shadow State - ${callId})]
模式: ${state.mode}
当前任务: ${state.task_id || '无'}
进度描述: ${state.progress || '初始状态'}
元数据: ${JSON.stringify(state.metadata)}
最后更新: ${new Date(state.lastUpdated).toLocaleString()}
`;
    }

    /**
     * [V2.1.0] 获取极简人设，供 SLC 快速起跑使用
     */
    async getCompactPersona(): Promise<string> {
        const userMd = await readWorkspaceFile(this.workspaceRoot, 'user.md') || '';
        const soulMd = await readWorkspaceFile(this.workspaceRoot, 'soul.md') || '';

        const userNameMatch = userMd.match(/用户名叫\s*(\S+)/) || userMd.match(/名字是\s*(\S+)/);
        const agentNameMatch = soulMd.match(/你是\s*(\S+)/);

        const userName = userNameMatch ? userNameMatch[1].replace(/[。，]/g, '') : '先生';
        const agentName = agentNameMatch ? agentNameMatch[1].replace(/[。，]/g, '') : 'Jarvis';

        return `你是 ${agentName}。用户是 ${userName}。风格: 优雅管家。`;
    }

    /**
     * [V1.9.0] 获取原始对话流，不带信封包装
     * [V3.2.0] 支持 global 模式：不限制 callId，用于入站加载
     */
    private async getRecentDialogueContextRaw(limit: number = 5, callIdFilter: string | null = null): Promise<string> {
        const messages = await this.getHistoryMessages(callIdFilter || 'global', limit);
        return messages.map(m => {
            const roleStr = m.role === 'user' ? '用户' : '助理';
            return `${roleStr}: ${m.content}`;
        }).join('\n');
    }

    /**
     * [V3.3.9] 获取结构化的对话历史，供 IFastAgent 直接消费
     */
    async getHistoryMessages(callId: string, limit: number = 10): Promise<any[]> {
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
                content: ShadowManager.decant(l.content)
            }));
        } catch (e) {
            console.error('[ShadowManager] getHistoryMessages error:', e);
            return [];
        }
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
        Object.assign(state, { ...patch, lastUpdated: Date.now() });

        // 3. 检查 Checkpoint
        const currentCount = (this.walCount.get(callId) || 0) + 1;
        this.walCount.set(callId, currentCount);

        if (currentCount >= this.MAX_WAL_ENTRIES) {
            await this.checkpoint(callId);
        }
    }

    /**
     * Checkpoint: 执行 Mirror Merge，将状态写回 MD 镜像并截断 WAL
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
                Object.assign(state, { ...entry.patch, lastUpdated: entry.timestamp });
            } catch (e) {
                console.warn(`[Recovery] Failed to parse WAL line for ${callId}`);
            }
        }
    }

    /**
     * 将对话记录持久化到 memory/ 目录，供 OpenClaw 主 Agent 感知
     */
    async logDialogue(callId: string, role: 'user' | 'assistant', content: string) {
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
     * [V3.1.0] 分层提示词拼装服务 (Layered Prompting Service)
     * 根据调用者身份 (SLC/SLE) 提供不同精细度的上下文
     */
    async assemblePrompt(type: 'SLC' | 'SLE', isNewSession: boolean = false): Promise<string> {
        const callId = getCurrentCallId() || 'global';
        const state = this.getScopedState();

        // 核心文件加载
        const [soulMd, userMd, agentsMd, identityMd, memoryMd] = await Promise.all([
            readWorkspaceFile(this.workspaceRoot, 'soul.md'),
            readWorkspaceFile(this.workspaceRoot, 'user.md'),
            readWorkspaceFile(this.workspaceRoot, 'AGENTS.md'),
            readWorkspaceFile(this.workspaceRoot, 'IDENTITY.md'),
            readWorkspaceFile(this.workspaceRoot, 'memory.md')
        ]);

        const now = new Date();
        const nowStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        if (type === 'SLC') {
            // [SLC] 极速交互模式：人设优先，轻量背景
            const recentHistory = await this.getRecentDialogueContextRaw(20, isNewSession ? null : callId);
            // 🚀 [V3.3.0] 优先使用由 SLE 提炼并写入元数据的高精度人设快照
            const personaSnapshot = state.metadata.compact_persona || soulMd || '你是 Jarvis，优雅管家。';

            return `
[ Jarvis 核心人设快照 ]
${personaSnapshot}
${identityMd || ''}

[ 当前环境 ]
本地时间: ${nowStr}

[ 用户画像 ]
${userMd || ''}

[ 近期交互锚点 ]
${recentHistory || '无'}
`.trim();
        } else {
            // [SLE] 逻辑专家模式：全量背景，规则优先
            const recentHistory = await this.getRecentDialogueContextRaw(5, isNewSession ? null : callId);
            return `
[ 角色与任务指南 ]
${soulMd || ''}
${agentsMd || ''}
${identityMd || ''}

[ 当前环境 ]
本地时间: ${nowStr}

[ 用户画像与长期记忆 ]
${userMd || ''}
${memoryMd || ''}

[ 最近 5 轮详细对白 ]
${recentHistory || '暂无历史记录'}

[ 任务影子状态 - ${callId} ]
模式: ${state.mode}
当前进度: ${state.progress || '进行中'}
元数据: ${JSON.stringify(state.metadata)}
`.trim();
        }
    }

    /**
     * [V3.1.0] 语义脱敏 (Decant): 彻底剥离所有内部思考和技术标签
     * [V3.2.0] 转发给全局 TextCleaner
     */
    static decant(text: string): string {
        return TextCleaner.decant(text);
    }

    /**
     * [V1.9.0] 获取最近的对话背景摘要，用于注入到 CLI 调用中
     */
    async getRecentDialogueContext(limit: number = 3): Promise<string> {
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
                .filter(l => l && l.callId === getCurrentCallId())
                .slice(-limit);

            // 使用统一的 decant 逻辑
            const summary = sessionLines.map(l => {
                const cleanContent = ShadowManager.decant(l.content);
                return `${l.role === 'user' ? '用户' : '助理'}: ${cleanContent}`;
            }).join(' | ');

            const state = this.getScopedState();
            return `[${summary}][当前状态: ${state.mode}${state.task_id ? `, 任务ID: ${state.task_id}` : ''}] `;
        } catch (e) {
            console.error('[ShadowManager] Failed to get recent context:', e);
            return "";
        }
    }

}
