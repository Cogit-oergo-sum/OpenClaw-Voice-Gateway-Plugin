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
    sleModel?: string;
    slcBaseUrl?: string;
    sleBaseUrl?: string;
}

export interface PluginConfig {
    zego?: ZegoConfig;
    llm: LlmConfig;
    tts?: TtsConfig;
    asr?: AsrConfig;
    advanced?: AdvancedConfig;
    fastAgent?: FastAgentInternalConfig;
}
