import * as fs from 'fs/promises';
import * as path from 'path';
import * as yaml from 'js-yaml';

/**
 * [V4.1] 模式定义：从配置文件加载
 */
export interface ModeDefinition {
  /** 模式名称（唯一标识） */
  name: string;
  /** 模式描述（用于System Prompt概述） */
  description: string;
  /** Markdown内容（模式提示词） */
  content: string;
  /** 文件路径 */
  filePath?: string;
}

/**
 * [V4.1] 模式配置文件 YAML Frontmatter 结构
 */
interface ModeFrontmatter {
  name: string;
  description: string;
}

/**
 * [V4.1] 全局模式配置
 */
export interface ModesConfig {
  initial_mode: string;
}

/**
 * [V4.1] ModeManager: 管理对话模式的加载、切换和提示词注入
 *
 * 职责：
 * - 从 workspace/modes/*.md 加载模式定义
 * - 动态生成 mode_switch 工具 schema
 * - 提供模式提示词查询接口
 * - 管理初始模式配置
 */
export class ModeManager {
  private modes: Map<string, ModeDefinition> = new Map();
  private initialMode: string = 'default';
  private modesConfigPath: string;
  private modesDirPath: string;

  constructor(workspaceRoot: string) {
    this.modesDirPath = path.join(workspaceRoot, 'modes');
    this.modesConfigPath = path.join(workspaceRoot, 'MODES_CONFIG.md');
  }

  /**
   * 从目录加载模式定义
   * 类似 SkillRegistry.loadFromDirectory 的实现
   */
  async loadFromDirectory(): Promise<void> {
    console.log(`[ModeManager] 正在从目录加载模式: ${this.modesDirPath}`);

    try {
      // 检查目录是否存在
      try {
        await fs.access(this.modesDirPath);
      } catch {
        console.warn(`[ModeManager] 模式目录不存在: ${this.modesDirPath}`);
        return;
      }

      const files = await fs.readdir(this.modesDirPath);

      for (const file of files) {
        if (!file.endsWith('.md')) continue;

        const filePath = path.join(this.modesDirPath, file);
        try {
          const content = await fs.readFile(filePath, 'utf8');
          const mode = this.parseModeFile(content, filePath);

          if (mode && mode.name && mode.description) {
            this.modes.set(mode.name, mode);
            console.log(`[ModeManager] 已加载模式: ${mode.name} (${mode.description.substring(0, 30)}...)`);
          } else {
            console.warn(`[ModeManager] 跳过 ${file}: 缺少 name 或 description`);
          }
        } catch (e: any) {
          console.warn(`[ModeManager] 加载 ${file} 失败: ${e.message}`);
        }
      }

      // 加载全局配置
      await this.loadModesConfig();

      console.log(`[ModeManager] 加载完成，共 ${this.modes.size} 个模式，初始模式: ${this.initialMode}`);
    } catch (e: any) {
      console.error(`[ModeManager] 加载目录失败: ${e.message}`);
    }
  }

  /**
   * 解析模式文件（YAML Frontmatter + Markdown 内容）
   */
  private parseModeFile(content: string, filePath: string): ModeDefinition | null {
    // 解析 YAML Frontmatter (通常在 --- 和 --- 之间)
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (!frontmatterMatch) {
      console.warn(`[ModeManager] 未找到 YAML Frontmatter: ${filePath}`);
      return null;
    }

    try {
      const frontmatter: ModeFrontmatter = yaml.load(frontmatterMatch[1]) as any;
      const markdownContent = content.slice(frontmatterMatch[0].length).trim();

      return {
        name: frontmatter.name,
        description: frontmatter.description,
        content: markdownContent,
        filePath
      };
    } catch (e) {
      console.warn(`[ModeManager] YAML 解析失败: ${filePath}`);
      return null;
    }
  }

  /**
   * 加载全局模式配置
   */
  private async loadModesConfig(): Promise<void> {
    try {
      await fs.access(this.modesConfigPath);
      const content = await fs.readFile(this.modesConfigPath, 'utf8');

      const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
      if (frontmatterMatch) {
        const config: ModesConfig = yaml.load(frontmatterMatch[1]) as any;
        if (config.initial_mode) {
          this.initialMode = config.initial_mode;
        }
      }
    } catch {
      // 配置文件不存在，使用默认值
      console.log(`[ModeManager] 未找到 MODES_CONFIG.md，使用默认初始模式: ${this.initialMode}`);
    }
  }

  /**
   * 获取 mode_switch 工具 schema（动态生成）
   * enum 值来自已加载的模式列表
   */
  getModeSwitchSchema(): any {
    const modeNames = Array.from(this.modes.keys());

    // 如果没有加载任何模式，返回一个空 schema（不影响 SLC）
    if (modeNames.length === 0) {
      console.warn('[ModeManager] 无可用模式，mode_switch 工具将不可用');
      return null;
    }

    return {
      type: 'function' as const,
      function: {
        name: 'mode_switch',
        description: '仅当当前模式不再适合用户话题时，切换到另一个不同的对话模式。禁止切换到当前已在的模式。',
        parameters: {
          type: 'object',
          properties: {
            target_mode: {
              type: 'string',
              enum: modeNames,
              description: '要切换到的目标模式（必须与当前模式不同）'
            },
            context: {
              type: 'object',
              description: '切换时可携带的上下文信息（如用户兴趣、当前状态等），具体内容由提示词定义'
            }
          },
          required: ['target_mode']
        }
      }
    };
  }

  /**
   * 获取所有模式的描述文本（用于 System Prompt）
   */
  getModeDescriptions(): string {
    return Array.from(this.modes.values())
      .map(m => `- ${m.name}: ${m.description}`)
      .join('\n');
  }

  /**
   * 获取指定模式的提示词内容
   */
  getModePrompt(modeName: string): string {
    const mode = this.modes.get(modeName);
    if (!mode) {
      console.warn(`[ModeManager] 未找到模式: ${modeName}`);
      return '';
    }
    return mode.content;
  }

  /**
   * 获取初始模式名称
   */
  getInitialMode(): string {
    return this.initialMode;
  }

  /**
   * 检查模式是否存在
   */
  hasMode(modeName: string): boolean {
    return this.modes.has(modeName);
  }

  /**
   * 获取所有模式名称
   */
  getModeNames(): string[] {
    return Array.from(this.modes.keys());
  }

  /**
   * [V4.7] 提取指定模式的切换条件文本
   * 从模式 .md 内容中提取"切换条件"或"模式跃迁"段落，供 SLE DECIDING prompt 使用
   */
  getSwitchConditions(modeName: string): string {
    const mode = this.modes.get(modeName);
    if (!mode) return '(无切换条件)';

    const content = mode.content;
    // 匹配"切换条件"或"模式跃迁"段落
    const switchMatch = content.match(/##\s*(?:切换条件|模式跃迁|⚠️\s*模式跃迁)[^\n]*\n([\s\S]*?)(?=\n##|\n#|$)/);
    if (switchMatch) return switchMatch[1].trim();

    // 兜底：匹配包含 mode_switch 的行
    const lines = content.split('\n').filter(l => l.includes('mode_switch'));
    return lines.length > 0 ? lines.join('\n') : '(无明确切换条件)';
  }

  /**
   * 处理 mode_switch 工具调用结果
   * 返回新的模式状态（不持久化，由 ShadowManager 管理）
   */
  handleModeSwitch(params: { target_mode: string; context?: any }): { new_mode: string; context?: any } {
    const { target_mode, context } = params;

    if (!this.hasMode(target_mode)) {
      console.warn(`[ModeManager] 无效的目标模式: ${target_mode}`);
      return { new_mode: this.initialMode };
    }

    console.log(`[ModeManager] 模式切换: ${target_mode}, context: ${JSON.stringify(context || {})}`);
    return { new_mode: target_mode, context };
  }
}