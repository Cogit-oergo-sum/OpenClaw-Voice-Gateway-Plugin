export interface ZegoConfig {
    appId: number;
    appSign?: string;
    serverSecret: string;
    aiAgentBaseUrl: string;
}

export interface LlmConfig {
    provider: string;
    apiKey: string;
    model: string;
    baseUrl: string;
}

export interface TtsConfig {
    vendor: string;
    appId: string;
    token: string;
    voiceType: string;
    resourceId: string;
}

export interface AsrConfig {
    vendor: string;
    params?: Record<string, string>;
    vadSilenceSegmentation?: number;
}

export interface AdvancedConfig {
    httpAuthToken: string;
    maxResponseTimeMs: number;
    memoryMaxTokens: number;
    soulMaxTokens: number;
    contextMaxRounds: number;
    messageWindowSize: number;
    maxConcurrentCalls?: number;
    allowSkillOverride?: boolean;
    fallbackMessage?: string;
}

export interface FastAgentInternalConfig {
    version?: string;
    slcModel?: string;
    routerModel?: string;
    sleModel?: string;
    slcBaseUrl?: string;
    slcApiKey?: string;
    sleBaseUrl?: string;
    sleApiKey?: string;
}

export interface PluginConfig {
    zego?: ZegoConfig;
    llm: LlmConfig;
    tts?: TtsConfig;
    asr?: AsrConfig;
    advanced?: AdvancedConfig;
    fastAgent?: FastAgentInternalConfig;
}

/**
 * [V4.0] Workspace 配置：支持通用 workspace 路径，不再强制依赖 openClaw
 * [V4.1] 新增 personaSource/dialogueSource，分离人设来源与工具后端
 */
export interface WorkspaceConfig {
    /** workspace 根目录路径 */
    path?: string;
    /** [V4.1] 人设文件来源：local（本地 workspace）或 openclaw（从 openClaw workspace） */
    personaSource?: 'local' | 'openclaw';
    /** [V4.1] 对话记录来源/写入位置：local 或 openclaw */
    dialogueSource?: 'local' | 'openclaw';
    /** [V4.1] openClaw workspace 路径（当 personaSource/dialogueSource=openclaw 时使用） */
    openclawPath?: string;
    /** 环境变量别名（向后兼容） */
    envAlias?: 'OPENCLAW_PROFILE' | 'OPENCLAW_WORKSPACE' | 'VOICE_GATEWAY_WORKSPACE';
}

/**
 * [V4.0] 工具后端配置：支持多种工具执行方式
 */
export interface ToolBackendConfig {
    /** 后端类型 */
    type: 'mock' | 'openclaw-docker' | 'http' | 'mcp';
    /** Mock 模式配置 */
    mock?: {
        /** Mock 响应延迟 ms */
        latency?: number;
    };
    /** openClaw Docker 配置 */
    openclawDocker?: OpenClawDockerConfig;
    /** HTTP Backend 配置 */
    http?: {
        /** HTTP endpoint URL */
        endpoint: string;
        /** HTTP method */
        method?: 'POST' | 'GET';
        /** 请求头 */
        headers?: Record<string, string>;
        /** 超时 ms */
        timeout?: number;
    };
}

/**
 * [V4.0] openClaw Docker 后端配置
 */
export interface OpenClawDockerConfig {
    /** 是否启用 openClaw 工具 */
    enabled: boolean;
    /** Docker 容器名 */
    container?: string;
    /** openClaw home 路径 */
    homePath?: string;
    /** 是否同步记忆到 openClaw */
    syncMemory?: boolean;
    /** 结束时是否合入 openClaw */
    syncOnExit?: boolean;
}

/**
 * [V4.0] 记忆同步插件配置
 */
export interface MemorySyncPluginConfig {
    /** 是否启用记忆同步 */
    enabled: boolean;
    /** 同步对话记录 */
    syncDialogue?: boolean;
    /** 同步人设文件 */
    syncPersonaFiles?: boolean;
    /** 人设文件列表 */
    personaFiles?: string[];
}

/**
 * [V4.0] 扩展配置：voice-agent-gateway 完整配置
 */
export interface VoiceGatewayConfig extends PluginConfig {
    /** Workspace 配置 */
    workspace?: WorkspaceConfig;
    /** 工具后端配置 */
    toolBackend?: ToolBackendConfig;
    /** 记忆同步插件配置 */
    memorySync?: MemorySyncPluginConfig;
}
