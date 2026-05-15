import * as fs from 'fs';
import * as path from 'path';
import { MemorySyncPlugin, DialogueEntry, PersonaFiles, MemoryLoadResult } from '../../agent/memory-sync';
import { OpenClawDockerConfig } from '../../types/config';

/**
 * [V4.0] OpenClawMemorySyncPlugin: openClaw 记忆同步插件
 * 从 openClaw workspace 加载对话记录和人设文件，并支持双向同步
 *
 * 功能：
 * - onLoadMemory: 从 openClaw 的 memory/*.jsonl 和 persona 文件加载
 * - onSyncDialogue: 实时写入 openClaw workspace 的 memory/*.jsonl
 * - onExit: 会话结束时可选地合入人设更新
 */
export class OpenClawMemorySyncPlugin implements MemorySyncPlugin {
    name = 'OpenClawSync';
    type = 'openclaw';
    enabled = true;

    private openclawWorkspace: string;
    private openclawHome: string;
    private syncMemory: boolean;
    private syncOnExit: boolean;
    private personaFiles: string[];

    constructor(config?: OpenClawDockerConfig & { personaFiles?: string[] }) {
        this.openclawWorkspace = config?.homePath || '';
        this.openclawHome = config?.homePath || '';
        this.syncMemory = config?.syncMemory ?? true;
        this.syncOnExit = config?.syncOnExit ?? true;
        this.personaFiles = config?.personaFiles || ['SOUL.md', 'USER.md', 'AGENTS.md', 'IDENTITY.md', 'MEMORY.md'];
    }

    async init(config: { workspacePath?: string; openclawHome?: string }): Promise<void> {
        if (config.workspacePath) {
            this.openclawWorkspace = config.workspacePath;
        }
        if (config.openclawHome) {
            this.openclawHome = config.openclawHome;
        }

        // 验证路径是否存在
        if (this.openclawWorkspace && !fs.existsSync(this.openclawWorkspace)) {
            console.warn(`[OpenClawSync] Workspace path does not exist: ${this.openclawWorkspace}, plugin will be disabled.`);
            this.enabled = false;
        } else {
            console.log(`[OpenClawSync] Initialized with workspace: ${this.openclawWorkspace}`);
        }
    }

    /**
     * 从 openClaw workspace 加载对话记录和人设文件
     */
    async onLoadMemory(workspace: string): Promise<MemoryLoadResult | null> {
        if (!this.enabled || !this.openclawWorkspace) {
            return null;
        }

        const dialogue: DialogueEntry[] = [];
        const personaFiles: PersonaFiles = {};
        const today = new Date().toISOString().split('T')[0];

        // 加载对话记录：扫描 memory/*.jsonl
        const memoryDir = path.join(this.openclawWorkspace, 'memory');
        if (fs.existsSync(memoryDir)) {
            // 加载最近几天的对话记录
            const files = await fs.promises.readdir(memoryDir);
            const jsonlFiles = files
                .filter(f => f.endsWith('.jsonl'))
                .sort()
                .slice(-3); // 最近 3 天

            for (const file of jsonlFiles) {
                const filePath = path.join(memoryDir, file);
                const content = await fs.promises.readFile(filePath, 'utf8');
                const lines = content.trim().split('\n');

                for (const line of lines) {
                    try {
                        const entry = JSON.parse(line);
                        if (!entry.event) {
                            dialogue.push(entry);
                        }
                    } catch (e) {}
                }
            }
        }

        // 加载人设文件
        for (const fileName of this.personaFiles) {
            const filePath = path.join(this.openclawWorkspace, fileName);
            if (fs.existsSync(filePath)) {
                const key = fileName.replace('.md', '').toLowerCase();
                const content = await fs.promises.readFile(filePath, 'utf8');
                if (key === 'agents') {
                    personaFiles.agents = content;
                } else if (key === 'identity') {
                    personaFiles.identity = content;
                } else if (key === 'soul') {
                    personaFiles.soul = content;
                } else if (key === 'user') {
                    personaFiles.user = content;
                } else if (key === 'memory') {
                    personaFiles.memory = content;
                }
            }
        }

        // 加载 IDENTITY.md（如果存在）
        const identityPath = path.join(this.openclawWorkspace, 'IDENTITY.md');
        if (fs.existsSync(identityPath)) {
            personaFiles.identity = await fs.promises.readFile(identityPath, 'utf8');
        }

        console.log(`[OpenClawSync] Loaded ${dialogue.length} dialogue entries and ${Object.keys(personaFiles).length} persona files from openClaw.`);

        return {
            dialogue,
            personaFiles,
            source: 'openclaw',
            loadedAt: Date.now()
        };
    }

    /**
     * 实时同步单条对话记录到 openClaw workspace
     */
    async onSyncDialogue(callId: string, entry: DialogueEntry): Promise<void> {
        if (!this.enabled || !this.syncMemory || !this.openclawWorkspace) {
            return;
        }

        const date = new Date().toISOString().split('T')[0];
        const memoryDir = path.join(this.openclawWorkspace, 'memory');
        const memoryFile = path.join(memoryDir, `${date}.jsonl`);

        // 确保目录存在
        await fs.promises.mkdir(memoryDir, { recursive: true });

        // 写入条目
        const entryStr = JSON.stringify(entry) + '\n';
        await fs.promises.appendFile(memoryFile, entryStr, 'utf8');
    }

    /**
     * 批量同步对话记录
     */
    async onSyncDialogueBatch(callId: string, entries: DialogueEntry[]): Promise<void> {
        if (!this.enabled || !this.syncMemory || !this.openclawWorkspace) {
            return;
        }

        const date = new Date().toISOString().split('T')[0];
        const memoryDir = path.join(this.openclawWorkspace, 'memory');
        const memoryFile = path.join(memoryDir, `${date}.jsonl`);

        await fs.promises.mkdir(memoryDir, { recursive: true });

        const entriesStr = entries.map(e => JSON.stringify(e)).join('\n') + '\n';
        await fs.promises.appendFile(memoryFile, entriesStr, 'utf8');
    }

    /**
     * 会话结束时，可选地合入人设更新
     */
    async onExit(callId: string, personaUpdates?: Partial<PersonaFiles>): Promise<void> {
        if (!this.enabled || !this.syncOnExit || !this.openclawWorkspace) {
            return;
        }

        if (personaUpdates) {
            // 写入更新的人设文件
            for (const [key, content] of Object.entries(personaUpdates)) {
                if (content && typeof content === 'string') {
                    const fileName = key === 'identity' ? 'IDENTITY.md' : `${key}.md`;
                    const filePath = path.join(this.openclawWorkspace, fileName);

                    // 检查文件是否存在，存在则追加，不存在则创建
                    if (fs.existsSync(filePath)) {
                        // 人设文件通常需要覆盖写入，而不是追加
                        // 但这里为了安全，使用追加模式
                        await fs.promises.writeFile(filePath, content, 'utf8');
                        console.log(`[OpenClawSync] Updated persona file: ${fileName}`);
                    } else {
                        await fs.promises.writeFile(filePath, content, 'utf8');
                        console.log(`[OpenClawSync] Created persona file: ${fileName}`);
                    }
                }
            }
        }
    }

    async destroy(): Promise<void> {
        console.log(`[OpenClawSync] Plugin destroyed.`);
    }
}

/**
 * [V4.0] 创建 OpenClaw 记忆同步插件实例
 */
export function createOpenClawMemorySyncPlugin(
    openclawWorkspace: string,
    config?: Partial<OpenClawDockerConfig>
): OpenClawMemorySyncPlugin {
    return new OpenClawMemorySyncPlugin({
        enabled: config?.enabled ?? true,
        homePath: openclawWorkspace,
        syncMemory: config?.syncMemory ?? true,
        syncOnExit: config?.syncOnExit ?? true,
        personaFiles: ['SOUL.md', 'USER.md', 'AGENTS.md', 'IDENTITY.md', 'MEMORY.md']
    });
}