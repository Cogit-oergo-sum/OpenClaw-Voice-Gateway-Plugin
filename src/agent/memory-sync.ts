import * as fs from 'fs';
import * as path from 'path';

/**
 * [V4.0] 对话记录条目
 */
export interface DialogueEntry {
    timestamp: number | string;
    callId: string;
    role: 'user' | 'assistant';
    content: string;
    event?: string;
    payload?: any;
}

/**
 * [V4.0] 人设文件数据
 */
export interface PersonaFiles {
    /** soul.md - AI 人设定义 */
    soul?: string;
    /** user.md - 用户信息 */
    user?: string;
    /** AGENTS.md - Agent 行为准则 */
    agents?: string;
    /** IDENTITY.md - 身份定义 */
    identity?: string;
    /** memory.md - 记忆配置 */
    memory?: string;
    /** 其他自定义文件 */
    custom?: Record<string, string>;
}

/**
 * [V4.0] 加载记忆数据
 */
export interface MemoryLoadResult {
    /** 对话记录列表 */
    dialogue: DialogueEntry[];
    /** 人设文件内容 */
    personaFiles: PersonaFiles;
    /** 加载来源标识 */
    source: string;
    /** 加载时间 */
    loadedAt: number;
}

/**
 * [V4.0] MemorySyncPlugin 接口：记忆同步插件
 * 支持双向同步对话记录和人设文件到外部系统
 *
 * 用途：
 * - 加载阶段：从外部系统（如 openClaw）读取历史记忆和人设
 * - 运行阶段：实时同步对话记录到外部系统
 * - 结束阶段：可选地合入人设更新
 */
export interface MemorySyncPlugin {
    /** 插件名称 */
    name: string;

    /** 插件类型标识 */
    type: string;

    /** 是否启用 */
    enabled: boolean;

    /**
     * 加载阶段：从外部系统读取对话记录和人设文件
     * @param workspace 当前 workspace 根目录
     * @returns 加载的记忆数据，包含对话记录和人设文件
     */
    onLoadMemory?(workspace: string): Promise<MemoryLoadResult | null>;

    /**
     * 运行阶段：实时同步单条对话记录到外部系统
     * @param callId 会话 ID
     * @param entry 对话记录条目
     */
    onSyncDialogue?(callId: string, entry: DialogueEntry): Promise<void>;

    /**
     * 运行阶段：批量同步对话记录到外部系统
     * @param callId 会话 ID
     * @param entries 对话记录条目列表
     */
    onSyncDialogueBatch?(callId: string, entries: DialogueEntry[]): Promise<void>;

    /**
     * 结束阶段：会话结束时，可选地合入人设更新
     * @param callId 会话 ID
     * @param personaUpdates 人设文件更新（如有）
     */
    onExit?(callId: string, personaUpdates?: Partial<PersonaFiles>): Promise<void>;

    /**
     * 初始化插件
     * @param config 插件配置
     */
    init?(config: any): Promise<void>;

    /**
     * 清理插件资源
     */
    destroy?(): Promise<void>;
}

/**
 * [V4.0] MemorySyncManager: 记忆同步管理器
 * 管理多个 MemorySyncPlugin，协调记忆的双向同步
 */
export class MemorySyncManager {
    private plugins: MemorySyncPlugin[] = [];

    /**
     * 注册插件
     */
    registerPlugin(plugin: MemorySyncPlugin): void {
        this.plugins.push(plugin);
        console.log(`[MemorySyncManager] Plugin ${plugin.name} (${plugin.type}) registered.`);
    }

    /**
     * 移除插件
     */
    removePlugin(name: string): void {
        this.plugins = this.plugins.filter(p => p.name !== name);
        console.log(`[MemorySyncManager] Plugin ${name} removed.`);
    }

    /**
     * 获取所有启用的插件
     */
    getEnabledPlugins(): MemorySyncPlugin[] {
        return this.plugins.filter(p => p.enabled);
    }

    /**
     * 加载阶段：从所有启用的插件加载记忆
     * 合并多个插件的数据，按优先级处理冲突
     */
    async loadMemory(workspace: string): Promise<MemoryLoadResult[]> {
        const results: MemoryLoadResult[] = [];

        for (const plugin of this.getEnabledPlugins()) {
            if (plugin.onLoadMemory) {
                try {
                    const result = await plugin.onLoadMemory(workspace);
                    if (result) {
                        results.push(result);
                        console.log(`[MemorySyncManager] Loaded memory from ${plugin.name}: ${result.dialogue.length} entries, ${Object.keys(result.personaFiles).length} persona files.`);
                    }
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to load memory from ${plugin.name}:`, e.message);
                }
            }
        }

        return results;
    }

    /**
     * 运行阶段：同步单条对话记录到所有启用的插件
     */
    async syncDialogue(callId: string, entry: DialogueEntry): Promise<void> {
        for (const plugin of this.getEnabledPlugins()) {
            if (plugin.onSyncDialogue) {
                try {
                    await plugin.onSyncDialogue(callId, entry);
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to sync dialogue to ${plugin.name}:`, e.message);
                }
            }
        }
    }

    /**
     * 运行阶段：批量同步对话记录到所有启用的插件
     */
    async syncDialogueBatch(callId: string, entries: DialogueEntry[]): Promise<void> {
        for (const plugin of this.getEnabledPlugins()) {
            if (plugin.onSyncDialogueBatch) {
                try {
                    await plugin.onSyncDialogueBatch(callId, entries);
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to batch sync dialogue to ${plugin.name}:`, e.message);
                }
            } else if (plugin.onSyncDialogue) {
                // 如果插件不支持批量同步，逐条同步
                for (const entry of entries) {
                    try {
                        await plugin.onSyncDialogue(callId, entry);
                    } catch (e: any) {
                        console.error(`[MemorySyncManager] Failed to sync dialogue to ${plugin.name}:`, e.message);
                    }
                }
            }
        }
    }

    /**
     * 结束阶段：通知所有启用的插件会话结束
     */
    async notifyExit(callId: string, personaUpdates?: Partial<PersonaFiles>): Promise<void> {
        for (const plugin of this.getEnabledPlugins()) {
            if (plugin.onExit) {
                try {
                    await plugin.onExit(callId, personaUpdates);
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to notify exit to ${plugin.name}:`, e.message);
                }
            }
        }
    }

    /**
     * 初始化所有插件
     */
    async initPlugins(configs: Record<string, any> = {}): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.init) {
                try {
                    await plugin.init(configs[plugin.name] || {});
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to init plugin ${plugin.name}:`, e.message);
                }
            }
        }
    }

    /**
     * 清理所有插件
     */
    async destroyPlugins(): Promise<void> {
        for (const plugin of this.plugins) {
            if (plugin.destroy) {
                try {
                    await plugin.destroy();
                } catch (e: any) {
                    console.error(`[MemorySyncManager] Failed to destroy plugin ${plugin.name}:`, e.message);
                }
            }
        }
    }
}

/**
 * [V4.0] LocalFileMemorySyncPlugin: 本地文件记忆同步插件
 * 默认实现，将记忆同步到本地 workspace 目录
 */
export class LocalFileMemorySyncPlugin implements MemorySyncPlugin {
    name = 'LocalFileSync';
    type = 'local-file';
    enabled = true;

    async onLoadMemory(workspace: string): Promise<MemoryLoadResult | null> {
        const dialogue: DialogueEntry[] = [];
        const personaFiles: PersonaFiles = {};
        const today = new Date().toISOString().split('T')[0];

        // 加载今日对话记录
        const memoryFile = path.join(workspace, `memory/${today}.jsonl`);
        if (fs.existsSync(memoryFile)) {
            const content = await fs.promises.readFile(memoryFile, 'utf8');
            const lines = content.trim().split('\n');
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line);
                    if (!entry.event) { // 过滤掉纯事件记录
                        dialogue.push(entry);
                    }
                } catch (e) {}
            }
        }

        // 加载人设文件
        // [V4.1] 使用大写文件名：SOUL.md, USER.md, AGENTS.md, IDENTITY.md, MEMORY.md
        const personaFileNames = ['SOUL.md', 'USER.md', 'AGENTS.md', 'IDENTITY.md', 'MEMORY.md'];
        for (const fileName of personaFileNames) {
            const filePath = path.join(workspace, fileName);
            if (fs.existsSync(filePath)) {
                const key = fileName.replace('.md', '').toLowerCase();
                if (key === 'agents') {
                    personaFiles.agents = await fs.promises.readFile(filePath, 'utf8');
                } else if (key === 'identity') {
                    personaFiles.identity = await fs.promises.readFile(filePath, 'utf8');
                } else if (key === 'soul') {
                    personaFiles.soul = await fs.promises.readFile(filePath, 'utf8');
                } else if (key === 'user') {
                    personaFiles.user = await fs.promises.readFile(filePath, 'utf8');
                } else if (key === 'memory') {
                    personaFiles.memory = await fs.promises.readFile(filePath, 'utf8');
                }
            }
        }

        return {
            dialogue,
            personaFiles,
            source: 'local-file',
            loadedAt: Date.now()
        };
    }

    async onSyncDialogue(callId: string, entry: DialogueEntry): Promise<void> {
        // 本地文件同步由 DialogueMemory 直接处理
        // 这里不需要额外操作，因为 DialogueMemory 已经会写入本地文件
    }

    async onExit(callId: string, personaUpdates?: Partial<PersonaFiles>): Promise<void> {
        // 本地模式下，人设更新直接写入 workspace 目录
        if (personaUpdates) {
            // 由 PromptAssembler 或外部逻辑处理写入
        }
    }
}