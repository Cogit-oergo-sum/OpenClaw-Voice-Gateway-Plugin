/**
 * [V4.0] 运行模式定义
 * 通过 VOICE_GATEWAY_MODE 环境变量统一控制系统行为
 */

/**
 * 运行模式枚举
 */
export type RuntimeMode = 'standalone' | 'openclaw' | 'mock' | 'http';

/**
 * 模式配置映射
 * 每个模式对应完整的系统配置预设
 */
export const MODE_CONFIGS: Record<RuntimeMode, {
    /** 工具后端类型 */
    toolBackendType: 'mock' | 'openclaw-docker' | 'http';
    /** 是否启用 openClaw 记忆同步 */
    enableOpenClawMemorySync: boolean;
    /** 默认 workspace 目录名 */
    defaultWorkspaceDir: string;
    /** 是否需要 Docker */
    requiresDocker: boolean;
    /** 模式描述 */
    description: string;
}> = {
    /**
     * standalone: 独立模式
     * - 不依赖任何外部系统
     * - 使用本地文件存储记忆和人设
     * - 工具执行返回 mock 结果
     * - 适合：演示、测试、无 openClaw 环境
     */
    standalone: {
        toolBackendType: 'mock',
        enableOpenClawMemorySync: false,
        defaultWorkspaceDir: 'workspace',
        requiresDocker: false,
        description: '独立模式 - 无外部依赖，本地文件存储'
    },

    /**
     * openclaw: openClaw 集成模式（向后兼容）
     * - 使用 openClaw Docker backend
     * - 启用记忆同步到 openClaw workspace
     * - 需要运行 openClaw Docker 容器
     * - 适合：生产环境、已有 openClaw 部署
     */
    openclaw: {
        toolBackendType: 'openclaw-docker',
        enableOpenClawMemorySync: true,
        defaultWorkspaceDir: '.openclaw/workspace',
        requiresDocker: true,
        description: 'openClaw 集成模式 - Docker backend + 记忆同步'
    },

    /**
     * mock: 开发调试模式
     * - 纯 mock，无任何真实执行
     * - 不写入文件（可选）
     * - 极速响应，用于 UI/逻辑调试
     * - 适合：开发调试、CI 测试
     */
    mock: {
        toolBackendType: 'mock',
        enableOpenClawMemorySync: false,
        defaultWorkspaceDir: 'workspace',
        requiresDocker: false,
        description: '开发调试模式 - 纯 mock，极速响应'
    },

    /**
     * http: HTTP Backend 模式
     * - 调用外部 HTTP 服务执行工具
     * - 不依赖 Docker
     * - 需要配置 HTTP_ENDPOINT 环境变量
     * - 适合：集成第三方工具服务
     */
    http: {
        toolBackendType: 'http',
        enableOpenClawMemorySync: false,
        defaultWorkspaceDir: 'workspace',
        requiresDocker: false,
        description: 'HTTP Backend 模式 - 调用外部工具服务'
    }
};

/**
 * 获取当前运行模式
 * 优先级：环境变量 VOICE_GATEWAY_MODE > 默认 standalone
 */
export function getRuntimeMode(): RuntimeMode {
    const mode = process.env.VOICE_GATEWAY_MODE?.toLowerCase() as RuntimeMode;

    if (mode && MODE_CONFIGS[mode]) {
        return mode;
    }

    // 向后兼容：如果检测到 OPENCLAW_MOCK=true，使用 mock 模式
    if (process.env.OPENCLAW_MOCK === 'true') {
        return 'mock';
    }

    // [V4.1] 移除自动回退到 openclaw 模式的逻辑
    // VOICE_GATEWAY_MODE 显式设置后，不再因 OPENCLAW_* 变量而切换模式
    // 用户如需"本地人设 + openClaw工具"：
    //   设置 VOICE_GATEWAY_MODE=standalone（人设本地）
    //   设置 VOICE_GATEWAY_TOOL_BACKEND=openclaw-docker（工具用 openClaw）
    // OPENCLAW_* 变量仅用于向后兼容的路径解析（见 getWorkspacePathForMode）

    // 默认使用 standalone 模式
    return 'standalone';
}

/**
 * 获取当前模式的配置
 */
export function getModeConfig() {
    const mode = getRuntimeMode();
    return MODE_CONFIGS[mode];
}

/**
 * 根据模式生成 ToolBackendConfig
 * [V4.1] 支持 VOICE_GATEWAY_TOOL_BACKEND 环境变量独立控制工具后端
 */
export function getToolBackendConfigForMode(): import('./types/config').ToolBackendConfig {
    const modeConfig = getModeConfig();

    // [V4.1] 新增：允许独立指定工具后端，覆盖模式默认值
    // 注意：mcp 类型暂未实现，只支持 mock、openclaw-docker、http
    const validBackends = ['mock', 'openclaw-docker', 'http'];
    const explicitBackend = process.env.VOICE_GATEWAY_TOOL_BACKEND as import('./types/config').ToolBackendConfig['type'];
    if (explicitBackend && validBackends.includes(explicitBackend)) {
        console.log(`[RuntimeMode] 使用显式指定的工具后端: ${explicitBackend}`);
        return buildBackendConfig(explicitBackend as 'mock' | 'openclaw-docker' | 'http');
    }

    // 否则使用模式默认 backend
    return buildBackendConfig(modeConfig.toolBackendType);
}

/**
 * [V4.1] 构建 BackendConfig 的辅助函数
 * 注意：MCP 类型暂未实现
 */
function buildBackendConfig(type: 'mock' | 'openclaw-docker' | 'http'): import('./types/config').ToolBackendConfig {
    const config: import('./types/config').ToolBackendConfig = {
        type
    };

    // HTTP 模式需要额外配置
    if (type === 'http') {
        const endpoint = process.env.VOICE_GATEWAY_HTTP_ENDPOINT;
        if (!endpoint) {
            console.warn('[RuntimeMode] HTTP 模式需要设置 VOICE_GATEWAY_HTTP_ENDPOINT 环境变量');
        }
        config.http = {
            endpoint: endpoint || 'http://localhost:8080/execute',
            method: 'POST',
            timeout: 30000
        };
    }

    // openClaw 模式的默认配置
    if (type === 'openclaw-docker') {
        config.openclawDocker = {
            enabled: true,
            container: process.env.OPENCLAW_DOCKER_CONTAINER || 'openclaw_voice_test',
            syncMemory: false,  // [V4.1] 默认不同步，由 personaSource/dialogueSource 控制
            syncOnExit: false
        };
    }

    return config;
}

/**
 * 根据模式生成 Workspace 路径
 */
export function getWorkspacePathForMode(): string {
    const modeConfig = getModeConfig();

    // 优先使用显式配置的环境变量
    if (process.env.VOICE_GATEWAY_WORKSPACE) {
        return process.env.VOICE_GATEWAY_WORKSPACE;
    }

    // 向后兼容
    if (process.env.OPENCLAW_PROFILE) {
        return process.env.OPENCLAW_PROFILE;
    }
    if (process.env.OPENCLAW_WORKSPACE) {
        return process.env.OPENCLAW_WORKSPACE;
    }

    // 使用模式默认路径
    const os = require('os');
    const path = require('path');

    if (modeConfig.defaultWorkspaceDir === '.openclaw/workspace') {
        return path.join(os.homedir(), '.openclaw', 'workspace');
    }

    // standalone/mock/http 默认使用当前目录下的 workspace
    return path.join(process.cwd(), modeConfig.defaultWorkspaceDir);
}

/**
 * 打印当前运行模式信息
 */
export function printRuntimeModeInfo(): void {
    const mode = getRuntimeMode();
    const config = getModeConfig();

    console.log(`
╔══════════════════════════════════════════════════════════╗
║  ZEGO-RealTimeAIAgent-3.0 Runtime Mode                   ║
╠══════════════════════════════════════════════════════════╣
║  Mode: ${mode.toUpperCase().padEnd(20)}                              ║
║  Description: ${config.description.padEnd(36)}         ║
║  Tool Backend: ${config.toolBackendType.padEnd(20)}                     ║
║  Memory Sync: ${config.enableOpenClawMemorySync ? 'openClaw' : 'local'.padEnd(20)}                ║
║  Requires Docker: ${config.requiresDocker ? 'Yes' : 'No'.padEnd(18)}                       ║
║  Workspace: ${getWorkspacePathForMode().slice(0, 40).padEnd(40)}...       ║
╚══════════════════════════════════════════════════════════╝
`);
}

/**
 * 环境变量速查表
 * [V4.1] 更新：新增 TOOL_BACKEND、PERSONA_SOURCE、DIALOGUE_SOURCE 环境变量
 */
export const ENV_VARS_GUIDE = `
环境变量速查表：

核心模式控制：
  VOICE_GATEWAY_MODE           运行模式 (standalone|openclaw|mock|http)

工具后端独立控制 [V4.1新增]：
  VOICE_GATEWAY_TOOL_BACKEND   工具后端类型 (mock|openclaw-docker|http)
                               可独立指定，覆盖模式默认值

人设/对话记录来源 [V4.1新增]：
  VOICE_GATEWAY_PERSONA_SOURCE 人设文件来源 (local|openclaw)
  VOICE_GATEWAY_DIALOGUE_SOURCE 对话记录来源 (local|openclaw)

路径配置：
  VOICE_GATEWAY_WORKSPACE      workspace 路径（所有模式）
  OPENCLAW_PROFILE             workspace 路径（向后兼容，openclaw 模式）
  OPENCLAW_WORKSPACE           workspace 路径（向后兼容，openclaw 模式）

HTTP 模式专用：
  VOICE_GATEWAY_HTTP_ENDPOINT  工具服务 HTTP endpoint

openClaw 模式专用：
  OPENCLAW_DOCKER_CONTAINER    Docker 容器名（默认 openclaw_voice_test）
  OPENCLAW_MOCK=true           开发调试模式（向后兼容）

典型配置示例：
  # 本地人设 + openClaw工具（混合模式）
  VOICE_GATEWAY_MODE=standalone
  VOICE_GATEWAY_TOOL_BACKEND=openclaw-docker
  VOICE_GATEWAY_WORKSPACE=/path/to/local/workspace

  # openClaw 全集成
  VOICE_GATEWAY_MODE=openclaw
  OPENCLAW_WORKSPACE=/path/to/openclaw/workspace
`;