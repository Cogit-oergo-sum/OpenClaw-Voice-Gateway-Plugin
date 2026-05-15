import { IFastSkill } from './iskill';
import { DelegateExecutor } from '../executor';
import { CallManager } from '../../call/call-manager';
import { AsrCorrectionSkill } from './core/asr-correction';
import { ToolBackendConfig } from '../../types/config';

/**
 * [V3.5.0] SkillRegistry: 技能注册中心
 * 统一管理所有可调用的 Skill 实例。
 * [V4.0] 支持条件注册和向后兼容别名
 */
export class SkillRegistry {
    private static instance: SkillRegistry;
    private skills: Map<string, IFastSkill> = new Map();
    private nativeHandlers: Map<string, Function> = new Map();
    // [V4.0] 别名映射：支持旧名称调用
    private aliases: Map<string, string> = new Map();
    // [V4.0] 禁用的 skill 列表
    private disabledSkills: Set<string> = new Set();

    private constructor() {}

    public static getInstance(): SkillRegistry {
        if (!SkillRegistry.instance) {
            SkillRegistry.instance = new SkillRegistry();
        }
        return SkillRegistry.instance;
    }

    /**
     * [V4.0] 禁用指定 skill
     */
    public disableSkill(name: string): void {
        this.disabledSkills.add(name);
        console.log(`[SkillRegistry] Skill ${name} 已禁用。`);
    }

    /**
     * [V4.0] 启用指定 skill
     */
    public enableSkill(name: string): void {
        this.disabledSkills.delete(name);
        console.log(`[SkillRegistry] Skill ${name} 已启用。`);
    }

    /**
     * [V4.0] 注册别名
     */
    public registerAlias(alias: string, targetName: string): void {
        this.aliases.set(alias, targetName);
        console.log(`[SkillRegistry] 别名 ${alias} -> ${targetName} 已注册。`);
    }

    /**
     * [V3.5.2] 注册 Native 闭包句柄
     * 用于 runtime: native 的技能直接调用内存函数
     */
    public registerNativeHandler(name: string, handler: Function): void {
        this.nativeHandlers.set(name, handler);
        console.log(`[SkillRegistry] Native Handler 注册成功: ${name}`);
    }

    /**
     * [V3.5.2] 获取 Native 闭包句柄
     */
    public getNativeHandler(name: string): Function | undefined {
        return this.nativeHandlers.get(name);
    }

    /**
     * [V3.5.2] 声明式挂载引擎：从指定目录动态加载业务技能
     * 职责：遍历 skills_repo 下的子文件夹，解析 SKILL.md 中的 YAML Frontmatter。
     */
    public async loadFromDirectory(dirPath: string): Promise<void> {
        const fs = await import('fs/promises');
        const path = await import('path');
        const yaml = await import('js-yaml');
        const { DynamicSkillWrapper } = await import('./DynamicSkillWrapper');

        console.log(`[SkillRegistry] 正在从目录加载动态技能: ${dirPath}`);

        try {
            // 确保目录存在
            try {
                await fs.access(dirPath);
            } catch {
                console.warn(`[SkillRegistry Warning] 技能目录不存在: ${dirPath}`);
                return;
            }

            const folders = await fs.readdir(dirPath);

            for (const folder of folders) {
                const skillDirPath = path.join(dirPath, folder);
                const stat = await fs.stat(skillDirPath);

                if (!stat.isDirectory()) continue;

                // 标准查找文件名：SKILL.md (大写优先)
                const skillFilePath = path.join(skillDirPath, 'SKILL.md');

                try {
                    await fs.access(skillFilePath);
                    const content = await fs.readFile(skillFilePath, 'utf8');

                    // 解析 YAML Frontmatter (通常在 --- 和 --- 之间)
                    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
                    if (!frontmatterMatch) {
                        console.warn(`[SkillRegistry] 跳过 ${folder}: 未找到合法的 YAML Frontmatter (未发现 --- 围栏)`);
                        continue;
                    }

                    const config: any = yaml.load(frontmatterMatch[1]);

                    if (!config || !config.name || !config.description) {
                        console.warn(`[SkillRegistry] 跳过 ${folder}: 缺少 name 或 description 核心属性`);
                        continue;
                    }

                    // 实例化并注册
                    const skill = new DynamicSkillWrapper({
                        name: config.name,
                        description: config.description,
                        parameters: config.parameters,
                        isLongRunning: config.isLongRunning,
                        runtime: config.runtime || 'mcp',
                        endpoint: config.endpoint || config.url, // 兼容 url 或 endpoint
                        method: config.method || 'POST'
                    });

                    // [V4.4] user-invocable 控制 Router 可见性（默认 true）
                    if (config['user-invocable'] === false) {
                        (skill as any).userInvocable = false;
                    }

                    this.register(skill);

                    // [V4.4] enabled: false → 自动禁用（兼容 openClaw SKILL.md 格式）
                    if (config.enabled === false) {
                        this.disableSkill(skill.name);
                    }

                    console.log(`[SkillRegistry] 已动态加载挂载技能: ${skill.name} (来自 ${folder}, runtime: ${skill.runtime})`);

                } catch (e: any) {
                    // 如果 SKILL.md 不存在，则静默跳过或打印
                    // console.log(`[SkillRegistry] 目录 ${folder} 无有效 SKILL.md 配置文件`);
                }
            }
        } catch (e: any) {
            console.error(`[SkillRegistry Error] 加载目录失败: ${e.message}`);
        }

        // [V4.4] 全局环境变量覆盖：DISABLED_SKILLS=delegate_task,weather_mcp
        const disabledEnv = process.env.DISABLED_SKILLS;
        if (disabledEnv) {
            const names = disabledEnv.split(',').map(s => s.trim()).filter(Boolean);
            for (const name of names) {
                this.disableSkill(name);
            }
            if (names.length > 0) {
                console.log(`[SkillRegistry] 环境变量 DISABLED_SKILLS 禁用: ${names.join(', ')}`);
            }
        }
    }

    /**
     * 注册一个新的技能
     * [V4.0] 支持别名注册
     */
    public register(skill: IFastSkill): void {
        // 检查是否被禁用
        if (this.disabledSkills.has(skill.name)) {
            console.log(`[SkillRegistry] Skill ${skill.name} 已被禁用，跳过注册。`);
            return;
        }

        this.skills.set(skill.name, skill);

        // [V4.0] 注册别名（如果 skill 有 aliases 属性）
        if ((skill as any).aliases && Array.isArray((skill as any).aliases)) {
            for (const alias of (skill as any).aliases) {
                this.registerAlias(alias, skill.name);
            }
        }
    }

    /**
     * 根据名称获取技能
     * [V4.0] 支持别名查找
     */
    public getSkill(name: string): IFastSkill | undefined {
        // 先检查是否被禁用
        if (this.disabledSkills.has(name)) {
            return undefined;
        }

        // 直接查找
        let skill = this.skills.get(name);

        // 如果没找到，尝试通过别名查找
        if (!skill && this.aliases.has(name)) {
            const targetName = this.aliases.get(name)!;
            skill = this.skills.get(targetName);
        }

        return skill;
    }

    /**
     * [V3.5.3] 注册系统级核心工具
     * [V4.4] delegate_task 已迁移至 skills_repo，通过 native handler 注册
     */
    public registerCoreSkills(_executor: DelegateExecutor, callManager?: CallManager, _backendConfig?: ToolBackendConfig): void {
        // ASR 纠错工具始终注册
        this.register(new AsrCorrectionSkill(callManager));
        console.log('[SkillRegistry] 系统核心工具 (ASR) 已注入内核。');
    }

    /**
     * [V3.5.3] 获取长耗时工具清单摘要，供 Router 参考
     */
    public getLongRunningSkillsSummary(): string {
        return Array.from(this.skills.values())
            .filter(s => s.isLongRunning)
            .map(s => `- ${s.name}: ${s.description}`)
            .join('\n');
    }

    /**
     * 获取所有可展示给大模型的 Tool Schemas
     */
    public getAllSchemas(): any[] {
        return Array.from(this.skills.values())
            .filter(s => !this.disabledSkills.has(s.name))
            .map(s => ({
                type: 'function',
                function: {
                    name: s.name,
                    description: s.description,
                    parameters: s.parameters
                }
            }));
    }

    /**
     * 是否存在指定技能
     * [V4.0] 支持别名检查
     */
    public hasSkill(name: string): boolean {
        if (this.disabledSkills.has(name)) return false;
        return this.skills.has(name) || this.aliases.has(name);
    }

    /**
     * [V4.4] 供 Router 使用的极简 Skill 摘要
     * 格式：每行 "name: description"，过滤禁用项
     */
    public getRouterSkillSummary(): string {
        return Array.from(this.skills.values())
            .filter(s => !this.disabledSkills.has(s.name) && s.source !== 'core' && (s as any).userInvocable !== false)
            .map(s => `${s.name}: ${s.description}`)
            .join('\n');
    }
}
