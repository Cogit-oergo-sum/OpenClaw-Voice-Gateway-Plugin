/**
 * [V4.0] 系统统一初始化
 * 根据运行模式自动配置所有组件
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import {
    RuntimeMode,
    getRuntimeMode,
    getModeConfig,
    getToolBackendConfigForMode,
    printRuntimeModeInfo
} from './runtime-mode';
import { PluginConfig, VoiceGatewayConfig, ToolBackendConfig, WorkspaceConfig } from './types/config';
import { DelegateExecutor } from './agent/executor';
import { DialogueMemory } from './agent/dialogue-memory';
import { MemorySyncManager, LocalFileMemorySyncPlugin, PersonaFiles } from './agent/memory-sync';
import { PromptAssembler } from './agent/prompt-assembler';
import { CanvasManager } from './agent/canvas-manager';
import { ShadowManager } from './agent/shadow-manager';
import { SkillRegistry } from './agent/skills';
import { OpenClawMemorySyncPlugin } from './plugins/openclaw';
import { resolveWorkspacePath, resolveOpenClawPath } from './context/loader';

/**
 * [V4.2] 人设精炼开关
 * 设为 "true" 则跳过 compact_persona 压缩，始终使用原始拼接
 */
export function isPersonaCompactDisabled(): boolean {
    return process.env.VOICE_GATEWAY_DISABLE_PERSONA_COMPACT === 'true';
}

/**
 * [V4.1] 获取人设来源配置
 * 优先级：环境变量 -> 配置对象 -> 默认值 local
 */
export function getPersonaSource(config?: WorkspaceConfig): 'local' | 'openclaw' {
    // 环境变量优先
    if (process.env.VOICE_GATEWAY_PERSONA_SOURCE === 'openclaw') {
        return 'openclaw';
    }
    if (process.env.VOICE_GATEWAY_PERSONA_SOURCE === 'local') {
        return 'local';
    }
    // 配置对象
    if (config?.personaSource) {
        return config.personaSource;
    }
    // 默认值
    return 'local';
}

/**
 * [V4.1] 获取对话记录来源配置
 */
export function getDialogueSource(config?: WorkspaceConfig): 'local' | 'openclaw' {
    if (process.env.VOICE_GATEWAY_DIALOGUE_SOURCE === 'openclaw') {
        return 'openclaw';
    }
    if (process.env.VOICE_GATEWAY_DIALOGUE_SOURCE === 'local') {
        return 'local';
    }
    if (config?.dialogueSource) {
        return config.dialogueSource;
    }
    return 'local';
}

/**
 * [V4.1] 获取 openClaw workspace 路径（用于 personaSource/dialogueSource=openclaw 时）
 */
export function getOpenClawPath(): string {
    return resolveOpenClawPath();
}

/**
 * [V4.0] 系统初始化配置
 */
export interface SystemInitConfig {
    /** LLM 配置（必需） */
    llmConfig: PluginConfig['llm'];
    /** RTC/ZEGO 配置（可选） */
    zegoConfig?: PluginConfig['zego'];
    /** TTS 配置（可选） */
    ttsConfig?: PluginConfig['tts'];
    /** ASR 配置（可选） */
    asrConfig?: PluginConfig['asr'];
    /** 高级配置（可选） */
    advancedConfig?: PluginConfig['advanced'];
    /** 强制指定模式（可选，默认从环境变量读取） */
    forceMode?: RuntimeMode;
    /** 强制指定 workspace 路径（可选，默认从环境变量读取） */
    forceWorkspace?: string;
}

/**
 * [V4.0] 系统初始化结果
 */
export interface SystemInitResult {
    /** 运行模式 */
    mode: RuntimeMode;
    /** 模式配置 */
    modeConfig: ReturnType<typeof getModeConfig>;
    /** Workspace 路径 */
    workspaceRoot: string;
    /** 工具执行器 */
    executor: DelegateExecutor;
    /** 对话记忆 */
    dialogueMemory: DialogueMemory;
    /** 记忆同步管理器 */
    memorySyncManager: MemorySyncManager;
    /** Prompt 组装器 */
    promptAssembler: PromptAssembler;
    /** Canvas 管理器 */
    canvasManager: CanvasManager;
    /** Shadow 状态管理器 */
    shadowManager: ShadowManager;
    /** 完整配置 */
    fullConfig: VoiceGatewayConfig;
}

/**
 * [V4.0] 系统统一初始化函数
 * 根据运行模式自动配置所有组件
 *
 * @param initConfig 初始化配置
 * @returns 初始化后的系统组件
 *
 * @example
 * // 最简初始化（只需 LLM 配置）
 * const system = await initializeSystem({
 *     llmConfig: {
 *         provider: 'anthropic',
 *         apiKey: process.env.ANTHROPIC_API_KEY!,
 *         model: 'claude-sonnet-4-6',
 *         baseUrl: 'https://api.anthropic.com'
 *     }
 * });
 *
 * // 通过环境变量控制模式
 * // VOICE_GATEWAY_MODE=openclaw -> 使用 openClaw Docker backend
 * // VOICE_GATEWAY_MODE=standalone -> 独立模式
 * // VOICE_GATEWAY_MODE=mock -> 开发调试模式
 */
export async function initializeSystem(initConfig: SystemInitConfig): Promise<SystemInitResult> {
    // 1. 确定运行模式
    const mode = initConfig.forceMode || getRuntimeMode();
    const modeConfig = getModeConfig();

    // 2. 确定 workspace 路径（使用 resolveWorkspacePath 解析为绝对路径）
    const workspaceRoot = initConfig.forceWorkspace || resolveWorkspacePath();

    // 确保 workspace 目录存在
    if (!fs.existsSync(workspaceRoot)) {
        await fs.promises.mkdir(workspaceRoot, { recursive: true });
        console.log(`[SystemInit] Created workspace directory: ${workspaceRoot}`);
    }

    // 打印运行模式信息
    printRuntimeModeInfo();

    // 3. 构建完整配置
    const toolBackendConfig = getToolBackendConfigForMode();
    const fullConfig: VoiceGatewayConfig = {
        llm: initConfig.llmConfig,
        zego: initConfig.zegoConfig,
        tts: initConfig.ttsConfig,
        asr: initConfig.asrConfig,
        advanced: initConfig.advancedConfig,
        workspace: {
            path: workspaceRoot
        },
        toolBackend: toolBackendConfig,
        memorySync: {
            enabled: modeConfig.enableOpenClawMemorySync,
            syncDialogue: modeConfig.enableOpenClawMemorySync,
            syncPersonaFiles: true,
            personaFiles: ['SOUL.md', 'USER.md', 'AGENTS.md', 'IDENTITY.md']
        }
    };

    // 4. 创建核心组件
    const executor = new DelegateExecutor(workspaceRoot, toolBackendConfig);
    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const canvasManager = new CanvasManager(workspaceRoot);
    const shadowManager = new ShadowManager(workspaceRoot);

    // 5. 创建记忆同步管理器并注入插件
    const memorySyncManager = new MemorySyncManager();

    // [V4.1] 根据 personaSource 和 dialogueSource 选择插件
    const personaSource = getPersonaSource(fullConfig.workspace);
    const dialogueSource = getDialogueSource(fullConfig.workspace);
    const openclawPath = getOpenClawPath();

    console.log(`[SystemInit] personaSource: ${personaSource}, dialogueSource: ${dialogueSource}`);

    if (personaSource === 'openclaw' || dialogueSource === 'openclaw') {
        // 需要 openClaw 记忆同步
        const openclawPlugin = new OpenClawMemorySyncPlugin({
            enabled: true,
            homePath: openclawPath,
            syncMemory: dialogueSource === 'openclaw',
            syncOnExit: personaSource === 'openclaw'
        });
        memorySyncManager.registerPlugin(openclawPlugin);
        console.log('[SystemInit] OpenClaw memory sync plugin registered.');
    }

    if (personaSource === 'local' || dialogueSource === 'local') {
        // 本地文件记忆同步（始终注册，作为默认）
        const localPlugin = new LocalFileMemorySyncPlugin();
        memorySyncManager.registerPlugin(localPlugin);
        console.log('[SystemInit] Local file memory sync plugin registered.');
    }

    // 注入记忆同步管理器
    dialogueMemory.setMemorySyncManager(memorySyncManager);

    // 6. 创建 PromptAssembler
    const promptAssembler = new PromptAssembler(
        workspaceRoot,
        dialogueMemory,
        canvasManager,
        shadowManager
    );
    promptAssembler.setMemorySyncManager(memorySyncManager);

    // 7. 加载外部记忆（如果有）
    await dialogueMemory.loadExternalMemory();

    // 8. 注册 Skills
    const registry = SkillRegistry.getInstance();
    registry.registerCoreSkills(executor, undefined, toolBackendConfig);

    // 加载动态 Skills（项目自带 + 工作区定制，同名 skill 工作区覆盖项目）
    const projectSkillDir = path.resolve(__dirname, '../skills_repo');
    if (fs.existsSync(projectSkillDir)) {
        await registry.loadFromDirectory(projectSkillDir);
    }
    const workspaceSkillDir = path.join(workspaceRoot, 'skills_repo');
    if (fs.existsSync(workspaceSkillDir)) {
        await registry.loadFromDirectory(workspaceSkillDir);
    }

    console.log('[SystemInit] ✅ System initialized successfully.');

    return {
        mode,
        modeConfig,
        workspaceRoot,
        executor,
        dialogueMemory,
        memorySyncManager,
        promptAssembler,
        canvasManager,
        shadowManager,
        fullConfig
    };
}

/**
 * [V4.0] 快速初始化（用于测试和演示）
 * 自动使用 mock 模式
 */
export async function initializeForTesting(llmApiKey?: string): Promise<SystemInitResult> {
    // 强制使用 mock 模式
    const mode: RuntimeMode = 'mock';

    return initializeSystem({
        llmConfig: {
            provider: 'anthropic',
            apiKey: llmApiKey || 'mock-api-key',
            model: 'claude-sonnet-4-6',
            baseUrl: 'https://api.anthropic.com'
        },
        forceMode: mode
    });
}