import { readWorkspaceFile } from '../context/loader';
import { ShadowState } from './shadow-manager';
import { DialogueMemory } from './dialogue-memory';

/**
 * [V3.3.0] PromptAssembler: 负责根据影子状态和对话记忆组装 LLM 提示词
 * 引入进程级缓存，减少对静态 Prompt 文件（如 soul.md）的磁盘 IO
 */
export class PromptAssembler {
    private fileCache: Map<string, string> = new Map();
    private cacheLoaded = false;

    constructor(
        private workspaceRoot: string,
        private dialogueMemory: DialogueMemory
    ) {}

    /**
     * 首次调用时加载所有静态 Prompt 文件到内存
     * soul.md, user.md, AGENTS.md, IDENTITY.md, memory.md 在运行期间几乎不变
     */
    private async ensureCache(): Promise<void> {
        if (this.cacheLoaded) return;
        const files = ['soul.md', 'user.md', 'AGENTS.md', 'IDENTITY.md', 'memory.md'];
        await Promise.all(files.map(async (f) => {
            const content = await readWorkspaceFile(this.workspaceRoot, f);
            this.fileCache.set(f, content || '');
        }));
        this.cacheLoaded = true;
    }

    /** 供外部在文件变更时调用（如热重载场景） */
    invalidateCache(): void {
        this.cacheLoaded = false;
        this.fileCache.clear();
    }

    /**
     * [V3.1.0] 分层提示词拼装服务 (Layered Prompting Service)
     * 根据调用者身份 (SLC/SLE) 提供不同精细度的上下文
     */
    async assemblePrompt(type: 'SLC' | 'SLE', callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        await this.ensureCache();

        const soulMd = this.fileCache.get('soul.md') || '';
        const userMd = this.fileCache.get('user.md') || '';
        const agentsMd = this.fileCache.get('AGENTS.md') || '';
        const identityMd = this.fileCache.get('IDENTITY.md') || '';
        const memoryMd = this.fileCache.get('memory.md') || '';

        const now = new Date();
        const nowStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}-${now.getDate().toString().padStart(2, '0')} ${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}:${now.getSeconds().toString().padStart(2, '0')}`;

        if (type === 'SLC') {
            const recentHistory = await this.dialogueMemory.getRecentDialogueContextRaw(20, isNewSession ? null : callId);
            const personaSnapshot = state.metadata.compact_persona || soulMd || '你是 Jarvis，优雅管家。';

            return `
[ Jarvis 核心人设快照 ]
${personaSnapshot}
${identityMd}

[ 当前环境 ]
本地时间: ${nowStr}

[ 用户画像 ]
${userMd}

[ 近期交互锚点 ]
${recentHistory || '无'}
`.trim();
        } else {
            const recentHistory = await this.dialogueMemory.getRecentDialogueContextRaw(5, isNewSession ? null : callId);
            return `
[ 角色与任务指南 ]
${soulMd}
${agentsMd}
${identityMd}

[ 当前环境 ]
本地时间: ${nowStr}

[ 用户画像与长期记忆 ]
${userMd}
${memoryMd}

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
     * 初始化：从持久化存储加载并构建 Prompt
     * [V3.2.0] isNewSession: 如果是首次连接，则从全局记忆库（跨会话）加载背景
     */
    async getContextPrompts(callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        await this.ensureCache();

        const soulMd = this.fileCache.get('soul.md') || '';
        const userMd = this.fileCache.get('user.md') || '';
        const agentsMd = this.fileCache.get('AGENTS.md') || '';
        const identityMd = this.fileCache.get('IDENTITY.md') || '';
        const memoryMd = this.fileCache.get('memory.md') || '';

        const recentHistory = await this.dialogueMemory.getRecentDialogueContextRaw(20, isNewSession ? null : callId);

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
        await this.ensureCache();
        const userMd = this.fileCache.get('user.md') || '';
        const soulMd = this.fileCache.get('soul.md') || '';

        const userNameMatch = userMd.match(/用户名叫\s*(\S+)/) || userMd.match(/名字是\s*(\S+)/);
        const agentNameMatch = soulMd.match(/你是\s*(\S+)/);

        const userName = userNameMatch ? userNameMatch[1].replace(/[。，]/g, '') : '先生';
        const agentName = agentNameMatch ? agentNameMatch[1].replace(/[。，]/g, '') : 'Jarvis';

        return `你是 ${agentName}。用户是 ${userName}。风格: 优雅管家。`;
    }
}
