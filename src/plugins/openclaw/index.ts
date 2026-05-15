/**
 * [V4.0] openClaw Plugin Index
 * 导出 openClaw 相关的所有插件组件
 */

// Memory Sync Plugin
export { OpenClawMemorySyncPlugin, createOpenClawMemorySyncPlugin } from './memory-sync-plugin';

// Plugin metadata
export const OPENCLAW_PLUGIN_INFO = {
    name: 'openclaw',
    version: '4.0.0',
    description: 'openClaw 集成插件 - 提供记忆同步和工具执行能力',
    author: 'ZEGO',
    components: {
        memorySync: 'OpenClawMemorySyncPlugin',
        toolBackend: 'OpenClawDockerBackend' // 在 src/agent/tool-backend.ts 中定义
    }
};

/**
 * [V4.0] 插件配置接口
 */
export interface OpenClawPluginConfig {
    /** openClaw workspace 路径 */
    workspacePath: string;
    /** openClaw home 路径 */
    homePath?: string;
    /** 是否启用记忆同步 */
    enableMemorySync?: boolean;
    /** 是否启用工具执行 */
    enableToolExecution?: boolean;
    /** Docker 容器名 */
    dockerContainer?: string;
    /** 结束时是否合入 */
    syncOnExit?: boolean;
}

/**
 * [V4.0] 创建完整的 openClaw 插件配置
 */
export function createOpenClawPluginConfig(config: Partial<OpenClawPluginConfig>): OpenClawPluginConfig {
    return {
        workspacePath: config.workspacePath || '',
        homePath: config.homePath,
        enableMemorySync: config.enableMemorySync ?? true,
        enableToolExecution: config.enableToolExecution ?? true,
        dockerContainer: config.dockerContainer || 'openclaw_voice_test',
        syncOnExit: config.syncOnExit ?? true
    };
}