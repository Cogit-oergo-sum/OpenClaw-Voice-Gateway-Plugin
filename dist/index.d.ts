import type { PluginConfig } from './types/config';
interface PluginAPI {
    registerHttpRoute(options: {
        path: string;
        auth?: string;
        match?: string;
        handler: (req: any, res: any) => Promise<void> | void;
    }): void;
    registerTool(options: any): void;
}
/**
 * OpenClaw Plugin 入口函数
 * (OpenClaw 加载插件后会自动调用 register() )
 */
export declare function register(api: PluginAPI, config: PluginConfig): void;
export {};
