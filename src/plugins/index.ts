/**
 * [V4.0] Plugins Index
 * 导出所有可用插件
 */

// openClaw Plugin
export * from './openclaw';

// Plugin Registry
import { MemorySyncPlugin, MemorySyncManager, LocalFileMemorySyncPlugin } from '../agent/memory-sync';

export { MemorySyncPlugin, MemorySyncManager, LocalFileMemorySyncPlugin };

/**
 * [V4.0] 插件类型定义
 */
export type PluginType = 'memory-sync' | 'tool-backend' | 'skill';

/**
 * [V4.0] 插件注册表
 * 用于管理所有已加载的插件
 */
export class PluginRegistry {
    private static instance: PluginRegistry;
    private registeredPlugins: Map<string, any> = new Map();

    private constructor() {}

    static getInstance(): PluginRegistry {
        if (!PluginRegistry.instance) {
            PluginRegistry.instance = new PluginRegistry();
        }
        return PluginRegistry.instance;
    }

    register(name: string, plugin: any): void {
        this.registeredPlugins.set(name, plugin);
        console.log(`[PluginRegistry] Plugin ${name} registered.`);
    }

    get(name: string): any | undefined {
        return this.registeredPlugins.get(name);
    }

    list(): string[] {
        return Array.from(this.registeredPlugins.keys());
    }
}