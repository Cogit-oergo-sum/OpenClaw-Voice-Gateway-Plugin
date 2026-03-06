import { CallManager } from '../call/call-manager';
import type { PluginConfig } from '../types/config';
/**
 * 接受 ZEGO AI Agent 传来的 LLM 请求，伪装成大模型进行结构化 SSE 返回
 */
export declare function chatCompletionsHandler(manager: CallManager, config: PluginConfig): (req: any, res: any) => Promise<void>;
