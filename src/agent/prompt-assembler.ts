import { readWorkspaceFile } from '../context/loader';
import { ShadowState } from './shadow-manager';
import { DialogueMemory } from './dialogue-memory';
import { SLEScenario } from './types';
import { SLEPayloadAssembler } from './sle-payload-assembler';
import { CanvasManager } from './canvas-manager';
import { TTS_FRIENDLY_PROTOCOL, MODE_SWITCH_OVERVIEW_TEMPLATE } from './prompts';
import { MemorySyncManager, PersonaFiles } from './memory-sync';
import { ModeManager } from './mode-manager';
import { isPersonaCompactDisabled } from '../system-init';

/**
 * [V3.3.0] PromptAssembler: 负责根据影子状态和对话记忆组装 LLM 提示词
 * [V3.6.0] 职责：场景场景化指令组装代理
 * [V4.0] 支持 MemorySyncPlugin，可从外部系统加载人设文件
 * [V4.1] 支持 personaSource 配置，可从 openClaw 或本地加载人设文件
 * [V4.1] 支持 ModeManager 模式切换概述注入
 */
export class PromptAssembler {
    private fileCache: Map<string, string> = new Map();
    private cacheLoaded = false;
    private memorySyncManager: MemorySyncManager | null = null;
    private externalPersonaFiles: PersonaFiles | null = null;
    private modeManager: ModeManager | null = null;

    /** [V4.1] 人设文件来源 */
    private personaSource: 'local' | 'openclaw' = 'local';
    /** [V4.1] openClaw workspace 路径（当 personaSource=openclaw 时使用） */
    private openclawWorkspacePath: string = '';
    /** [V4.7] Prompt 变体子目录（从 prompts/{subDir}/ 加载 persona 文件） */
    private personaSubDir: string = '';

    constructor(
        private workspaceRoot: string,
        private dialogueMemory: DialogueMemory,
        private canvasManager: CanvasManager,
        private shadowManager: import('./shadow-manager').ShadowManager
    ) {}

    /**
     * [V4.1] 设置 ModeManager
     */
    setModeManager(manager: ModeManager): void {
        this.modeManager = manager;
    }

    /**
     * [V4.1] 设置人设来源配置
     */
    setPersonaSource(source: 'local' | 'openclaw'): void {
        this.personaSource = source;
    }

    /**
     * [V4.1] 设置 openClaw workspace 路径
     */
    setOpenClawWorkspacePath(path: string): void {
        this.openclawWorkspacePath = path;
    }

    /**
     * [V4.7] 设置 Prompt 变体子目录
     * 当设置后，persona 文件从 {workspaceRoot}/prompts/{subDir}/ 优先加载
     * 不设置时行为完全不变（从 workspaceRoot 根目录加载）
     */
    setPersonaSubDir(subDir: string): void {
        this.personaSubDir = subDir;
        this.invalidateCache();
    }

    /**
     * [V4.0] 设置 MemorySyncManager
     */
    setMemorySyncManager(manager: MemorySyncManager): void {
        this.memorySyncManager = manager;
    }

    /**
     * [V4.0] 设置外部人设文件（从 MemorySyncPlugin 加载）
     */
    setExternalPersonaFiles(files: PersonaFiles): void {
        this.externalPersonaFiles = files;
        this.invalidateCache(); // 清除缓存以使用新文件
    }

    private async ensureCache(): Promise<void> {
        if (this.cacheLoaded) return;

        // [V4.0] 优先使用外部人设文件（从 MemorySyncPlugin 加载）
        if (this.externalPersonaFiles) {
            for (const [key, content] of Object.entries(this.externalPersonaFiles)) {
                if (content) {
                    // 将 key 映射到标准文件名
                    const fileName = key === 'identity' ? 'IDENTITY.md' :
                                    key === 'agents' ? 'AGENTS.md' :
                                    `${key}.md`;
                    this.fileCache.set(fileName, content);
                }
            }
        }

        // [V4.1] 根据 personaSource 决定本地加载路径
        const personaWorkspace = this.personaSource === 'openclaw' && this.openclawWorkspacePath
            ? this.openclawWorkspacePath
            : this.workspaceRoot;

        // 加载本地文件（补充或覆盖）
        // [V4.1] 使用大写文件名：SOUL.md, USER.md, AGENTS.md, IDENTITY.md, MEMORY.md
        const files = ['SOUL.md', 'USER.md', 'AGENTS.md', 'IDENTITY.md', 'MEMORY.md'];
        await Promise.all(files.map(async (f) => {
            // 如果外部文件已存在且不需要覆盖，则跳过
            if (this.externalPersonaFiles && this.fileCache.has(f)) {
                return;
            }
            // [V4.7] 优先从 prompts/{personaSubDir}/ 子目录加载
            let content: string | null = null;
            if (this.personaSubDir) {
                content = await readWorkspaceFile(personaWorkspace, `prompts/${this.personaSubDir}/${f}`);
            }
            // 子目录未找到时 fallback 到根目录
            if (content === null) {
                content = await readWorkspaceFile(personaWorkspace, f);
            }
            this.fileCache.set(f, content || '');
        }));

        // [V4.7] 打印人设加载来源信息（含变体子目录）
        const subDirInfo = this.personaSubDir ? `, subDir=${this.personaSubDir}` : '';
        console.log(`[PromptAssembler] 人设文件加载完成: source=${this.personaSource}, workspace=${personaWorkspace}${subDirInfo}`);

        this.cacheLoaded = true;
    }

    invalidateCache(): void {
        this.cacheLoaded = false;
        this.fileCache.clear();
    }

    /**
     * [V4.2] 直接按模板拼接原始配置文件内容
     * 只有当总字数超过 3000 字时，才调用 SLE 压缩提炼
     *
     * 标题降级规则：将文件中的 # → ##，## → ### 等，防止与模板标题冲突
     */
    private async buildRawPrompt(): Promise<string> {
        await this.ensureCache();

        const identity = this.downgradeMarkdownHeaders(this.fileCache.get('IDENTITY.md') || '');
        const soul = this.downgradeMarkdownHeaders(this.fileCache.get('SOUL.md') || '');
        const agents = this.downgradeMarkdownHeaders(this.fileCache.get('AGENTS.md') || '');
        const user = this.downgradeMarkdownHeaders(this.fileCache.get('USER.md') || '');
        const memory = this.downgradeMarkdownHeaders(this.fileCache.get('MEMORY.md') || '');

        return `# 角色定义
${identity}

# 角色风格
${soul}

# 行为逻辑
${agents}

# 用户信息
${user}

# 关键记忆
${memory}`;
    }

    /**
     * [V4.2] Markdown 标题降级
     * 将所有标题级别降低一级：# → ##，## → ### 等
     */
    private downgradeMarkdownHeaders(content: string): string {
        return content.replace(/^(#{1,6})\s/gm, (_match, hashes) => {
            // 增加一个 # 符号，标题降一级
            return hashes + '#' + ' ';
        });
    }

    /**
     * [V4.2] 供外部调用：获取原始拼接内容（用于压缩判断）
     */
    async buildRawPromptForCompression(): Promise<string> {
        return this.buildRawPrompt();
    }

    /**
     * [V4.2] 构建最终 SLC System Prompt
     * 添加运行环境、模式切换概述、TTS 协议
     */
    private buildFinalPrompt(coreContent: string): string {
        const canvas = this.canvasManager.getCanvas(this.currentCallId || 'global');
        const now = canvas.env.time || new Date().toLocaleString('zh-CN', { hour12: false });

        // [V4.1] 注入模式切换概述（如果 ModeManager 可用且有模式定义）
        // [ARCH] 传递 funcMode 给模板，切换 FC/FUNC 标签指令
        let modeOverview = '';
        if (this.modeManager && this.modeManager.getModeNames().length > 0) {
            const funcMode = (process.env.VOICE_GATEWAY_ARCH_FUNC === 'func_tags') ? 'func_tags' as const : 'fc' as const;
            modeOverview = MODE_SWITCH_OVERVIEW_TEMPLATE(this.modeManager.getModeDescriptions(), funcMode);
        }

        // [ARCH] slc_prompt 模式下注入意图判断上下文（Canvas/Skills）
        let intentContext = '';
        if (process.env.VOICE_GATEWAY_ARCH_INTENT === 'slc_prompt') {
            const tasksLite = (canvas.tasks || []).map((t: any) => ({ id: t.id, name: t.name, status: t.status }));
            intentContext = `\n[意图判断上下文]\n当前任务: ${JSON.stringify(tasksLite)}\n（可用工具见 AGENTS.md 意图判断能力段落）`;
        }

        return `${coreContent}

${modeOverview}${intentContext}[ 当前运行环境 ]
本地时间: ${now}

${TTS_FRIENDLY_PROTOCOL}`.trim();
    }

    /** [V4.2] 当前处理的 callId（用于 buildFinalPrompt 获取时间） */
    private currentCallId: string = '';

    /** [V4.2] 原始提示词是否已压缩（避免重复压缩） */
    private compressedCallIds: Set<string> = new Set();

    /**
     * [V4.2] SLC System Prompt 组装
     * - 直接拼接原始配置文件
     * - 只有超过 3000 字才压缩提炼
     * - 压缩后存入 compact_persona，后续直接使用缓存
     */
    async assemblePrompt(type: 'SLC', callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        this.currentCallId = callId;
        await this.ensureCache();

        const compactDisabled = isPersonaCompactDisabled();

        // 1. 检查是否已压缩过（后续直接使用缓存）
        if (!compactDisabled && this.compressedCallIds.has(callId) && state.metadata.compact_persona) {
            return this.buildFinalPrompt(state.metadata.compact_persona);
        }

        // 2. 构建原始拼接内容
        const rawPrompt = await this.buildRawPrompt();
        const charCount = rawPrompt.length;

        // 3. 判断是否需要压缩（超过 3000 字）
        if (!compactDisabled && charCount > 3000) {
            console.log(`[PromptAssembler] 原始提示词 ${charCount} 字超过 3000 字限制，触发压缩`);

            // 使用已有的 compact_persona 或重新压缩
            if (state.metadata.compact_persona && state.metadata.last_persona_char_count === charCount) {
                // 字数未变化，使用已有缓存
                return this.buildFinalPrompt(state.metadata.compact_persona);
            }

            // 需要压缩（由外部 FastAgentV3 调用 refreshCompactPersona 完成）
            // 这里返回一个临时简化版本，等待压缩完成
            const tempCompact = await this.getCompactPersona();
            return this.buildFinalPrompt(tempCompact);
        }

        // 4. 未超过限制，直接使用原始拼接
        console.log(`[PromptAssembler] 原始提示词 ${charCount} 字，直接使用`);
        return this.buildFinalPrompt(rawPrompt);
    }

    /**
     * [V4.2] 标记该 callId 已完成压缩
     */
    markCompressed(callId: string): void {
        this.compressedCallIds.add(callId);
    }

    /**
     * @deprecated [V3.6.0] 仅供 refreshCompactPersona 获取全量原始上下文使用。
     */
    async getContextPrompts(callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        await this.ensureCache();
        const history = await this.dialogueMemory.getRecentDialogueContextRaw(20, isNewSession ? null : callId);
        return `[Persona]\n${this.fileCache.get('SOUL.md') || ''}\n${this.fileCache.get('IDENTITY.md') || ''}\n\n[User]\n${this.fileCache.get('USER.md') || ''}\n\n[History]\n${history || '无'}\n\n[State]\n${JSON.stringify(state.metadata)}`;
    }

    /**
     * [V3.6.28] 稳健的临时人设提取 (用于 SLE 快照未就绪前的首轮对话兜底)
     */
    async getCompactPersona(): Promise<string> {
        await this.ensureCache();
        const userMd = this.fileCache.get('USER.md') || '';
        const soulMd = this.fileCache.get('SOUL.md') || '';
        
        // 通用名称提取
        const userNameMatch = userMd.match(/姓名[:：]\s*(\S+)/) || 
                              userMd.match(/称呼[:：]\s*(\S+)/) || 
                              userMd.match(/用户名叫\s*(\S+)/);
        const userName = userNameMatch ? userNameMatch[1].replace(/[。，\*#]/g, '') : '先生';
        
        // 通用角色名称提取
        const agentNameMatch = soulMd.match(/#\s*(\S+)\s*Soul/i) || 
                               soulMd.match(/你是\s*(?!(?:由|一个))(\S+)/);
        const agentName = agentNameMatch ? agentNameMatch[1].replace(/[。，\*#]/g, '') : 'Jarvis';
        
        // 尝试从 Soul.md 提取 风格/语感/语气
        const styles: string[] = [];
        [/风格[:：]\s*([^\s。，！]+)/, /语感[:：]\s*([^\s。，！]+)/, /语气[:：]\s*([^\s。，！]+)/].forEach(regex => {
            const m = soulMd.match(regex);
            if (m) styles.push(m[1].replace(/[。，\*#]/g, ''));
        });
        const styleText = styles.length > 0 ? Array.from(new Set(styles)).join('/') : '优雅管家';
        
        return `你是 ${agentName}。用户是 ${userName}。风格: ${styleText}。`;
    }



    async assembleSLEPayload(scenario: SLEScenario, callId: string, params: any): Promise<Array<{ role: string; content: string }>> {
        await this.ensureCache();

        // [V4.4] ROUTING 场景：注入 Canvas + Skills 摘要
        if (scenario === 'ROUTING') {
            const canvas = this.canvasManager.getCanvas(callId);
            params.canvasSnapshot = JSON.stringify({
                env: canvas.env,
                tasks: (canvas.tasks || []).map(t => ({
                    id: t.id,
                    name: t.name,
                    status: t.status
                }))
            });
            // [V4.4] 注入 Skill 摘要供 Router 感知
            const { SkillRegistry } = require('./skills');
            params.skillsSummary = SkillRegistry.getInstance().getRouterSkillSummary();
            return SLEPayloadAssembler.assemble(scenario, callId, '', params);
        }

        // 其他场景保持原有逻辑
        const skills_summary_raw = this.fileCache.get('AGENTS.md') || '';
        const { SkillRegistry } = require('./skills');
        const skillSummaryText = SkillRegistry.getInstance().getLongRunningSkillsSummary();
        let skills_summary = `[ 可用长耗时意图清单 ]\n${skillSummaryText || '- (当前无动态加载工具)'}`;
        skills_summary += `\n\n[ 交互准则 ]\n${skills_summary_raw}`;

        if (scenario === 'SUMMARIZING') {
            const canvas = this.canvasManager.getCanvas(callId);
            params.canvasSnapshot = JSON.stringify({
                env: canvas.env,
                tasks: (canvas.tasks || []).map(t => ({
                    id: t.id,
                    name: t.name,
                    status: t.status,
                    summary: t.summary ? (t.summary.length > 50 ? t.summary.slice(0, 50) + '...' : t.summary) : ''
                }))
            });
        } else if (scenario === 'REFINING' && !params.fullPersonaContext) {
            const state = this.shadowManager.getOrCreateState(callId);
            params.fullPersonaContext = await this.getContextPrompts(callId, state, false);
        } else if (scenario === 'ASR_CORRECTION') {
            params.recentHistoryRaw = await this.dialogueMemory.getRecentDialogueContextRaw(5, callId);
        }

        // [V4.7] 注入模式上下文：当前模式 + 切换条件，供 SLE DECIDING 判断 MODE_SWITCH
        if (scenario === 'DECIDING' && this.modeManager) {
            const state = this.shadowManager.getOrCreateState(callId);
            const currentMode = state.metadata.current_mode || this.modeManager.getInitialMode();
            params.modeContext = {
                currentMode,
                modePromptSummary: this.modeManager.getModePrompt(currentMode)?.substring(0, 300) || '',
                switchConditions: this.modeManager.getSwitchConditions(currentMode)
            };
        }

        return SLEPayloadAssembler.assemble(scenario, callId, skills_summary, params);
    }

}
