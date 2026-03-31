import { readWorkspaceFile } from '../context/loader';
import { ShadowState } from './shadow-manager';
import { DialogueMemory } from './dialogue-memory';
import { SLEScenario } from './types';
import { SLEPayloadAssembler } from './sle-payload-assembler';
import { CanvasManager } from './canvas-manager';
import { TTS_FRIENDLY_PROTOCOL } from './prompts';

/**
 * [V3.3.0] PromptAssembler: 负责根据影子状态和对话记忆组装 LLM 提示词
 * [V3.6.0] 职责：场景场景化指令组装代理
 */
export class PromptAssembler {
    private fileCache: Map<string, string> = new Map();
    private cacheLoaded = false;

    constructor(
        private workspaceRoot: string,
        private dialogueMemory: DialogueMemory,
        private canvasManager: CanvasManager
    ) {}

    private async ensureCache(): Promise<void> {
        if (this.cacheLoaded) return;
        const files = ['soul.md', 'user.md', 'AGENTS.md', 'IDENTITY.md', 'memory.md'];
        await Promise.all(files.map(async (f) => {
            const content = await readWorkspaceFile(this.workspaceRoot, f);
            this.fileCache.set(f, content || '');
        }));
        this.cacheLoaded = true;
    }

    invalidateCache(): void {
        this.cacheLoaded = false;
        this.fileCache.clear();
    }

    /**
     * [V3.6.0] 仅保留 SLC 极速响应场景
     */
    async assemblePrompt(type: 'SLC', callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        await this.ensureCache();
        const canvas = this.canvasManager.getCanvas(callId);
        const now = canvas.env.time || new Date().toLocaleString('zh-CN', { hour12: false });
        
        // [V3.6.4] 核心改进：SLC 系统提示词由 SLE 总结的高密度人设（PersonaSnapshot）与即时运行环境（Now）构成。
        // 不再包裹冗余标签，也不再注入 [ 近期交互锚点 ]（历史记录已经在 messages 数组中）。
        let personaSnapshot = state.metadata.compact_persona || await this.getCompactPersona();
        
        // 彻底移除可能残留的标签
        personaSnapshot = personaSnapshot.replace(/\[\s*Jarvis\s*核心人设快照\s*\]\n?/g, '').trim();
        
        return `${personaSnapshot}\n\n[ 当前运行环境 ]\n本地时间: ${now}\n\n${TTS_FRIENDLY_PROTOCOL}`.trim();
    }

    /**
     * @deprecated [V3.6.0] 仅供 refreshCompactPersona 获取全量原始上下文使用。
     */
    async getContextPrompts(callId: string, state: ShadowState, isNewSession: boolean = false): Promise<string> {
        await this.ensureCache();
        const history = await this.dialogueMemory.getRecentDialogueContextRaw(20, isNewSession ? null : callId);
        return `[Persona]\n${this.fileCache.get('soul.md') || ''}\n${this.fileCache.get('AGENTS.md') || ''}\n${this.fileCache.get('IDENTITY.md') || ''}\n\n[User]\n${this.fileCache.get('user.md') || ''}\n\n[History]\n${history || '无'}\n\n[State]\n${JSON.stringify(state.metadata)}`;
    }

    /**
     * [V3.6.28] 稳健的临时人设提取 (用于 SLE 快照未就绪前的首轮对话兜底)
     */
    async getCompactPersona(): Promise<string> {
        await this.ensureCache();
        const userMd = this.fileCache.get('user.md') || '';
        const soulMd = this.fileCache.get('soul.md') || '';
        
        // 用户名称提取
        const userNameMatch = userMd.match(/姓名[:：]\s*(\S+)/) || 
                              userMd.match(/称呼[:：]\s*(\S+)/) || 
                              userMd.match(/用户名叫\s*(\S+)/);
        const userName = userNameMatch ? userNameMatch[1].replace(/[。，\*#]/g, '') : '先生';
        
        // 人称/角色名称提取：优化正则，增加对不同标记的支持，并使用负向先行断言排除常用前缀
        const agentNameMatch = soulMd.match(/#\s*(\S+)\s*Soul/i) || 
                               soulMd.match(/#\s*(\S+)\s*协议/i) || 
                               soulMd.match(/#\s*(\S+)\s*核心/i) ||
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
        const skills_summary_raw = this.fileCache.get('AGENTS.md') || '';
        
        // [V3.6.1] 注入实时注册的技能清单，确保 IntentRouter 有真实的判定依据
        const { SkillRegistry } = require('./skills');
        // [V3.6.1] 针对 ROUTING 场景执行瘦身：仅保留核心意图清单，剔除全量 AGENTS.md 准则
        const skillSummaryText = SkillRegistry.getInstance().getLongRunningSkillsSummary();
        let skills_summary = `[ 可用长耗时意图清单 ]\n${skillSummaryText || '- (当前无动态加载工具)'}`;
        if (scenario !== 'ROUTING') {
            skills_summary += `\n\n[ 交互准则 ]\n${skills_summary_raw}`;
        }

        if (scenario === 'ROUTING' || scenario === 'SUMMARIZING') {
            const canvas = this.canvasManager.getCanvas(callId);
            params.canvasSnapshot = JSON.stringify({ 
                env: canvas.env, 
                task_status: canvas.task_status 
            });
            params.recentHistorySummary = await this.dialogueMemory.getRecentDialogueContextRaw(3, callId);
        } else if (scenario === 'ASR_CORRECTION') {
            params.recentHistoryRaw = await this.dialogueMemory.getRecentDialogueContextRaw(5, callId);
        }
        
        return SLEPayloadAssembler.assemble(scenario, callId, skills_summary, params);
    }

}
