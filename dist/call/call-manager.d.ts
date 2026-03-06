export interface CallState {
    userId: string;
    agentInstanceId?: string;
    roomId?: string;
    agentUserId?: string;
    agentStreamId?: string;
    userStreamId?: string;
    startTime: Date;
    status: 'creating' | 'active' | 'ending';
    controlToken: string;
    cachedPromptPrefix: string;
    cachedPromptSuffix: string;
    memoryMtime: number;
    dynamicHotwords: string[];
    aliasMap: Map<string, string>;
    conversationBuffer: Array<{
        role: string;
        content: string;
    }>;
}
import { ZegoApiClient } from './zego-api';
import type { PluginConfig } from '../types/config';
/**
 * 掌管整个 Plugin 生命周期的状态
 */
export declare class CallManager {
    config: PluginConfig;
    private activeCalls;
    api: ZegoApiClient;
    workspaceRoot: string;
    private zombieSweeperTimer;
    private readonly MAX_CALL_DURATION_MS;
    constructor(config: PluginConfig);
    /**
     * 停止 Manager 内所有的资源和轮询（方便单元测试和卸载）
     */
    destroy(): void;
    /**
     * 每 5 分钟扫描一次内存 map。
     * 检测到超过物理连接上限、因客户端断网未能调用 end-call 成为僵尸的 Call，主动发车销毁。
     */
    private sweepZombies;
    /**
     * 当前并发活跃数
     */
    get activeCount(): number;
    /**
     * 将目前的活跃实例 ID 集合异步刷写到本地，防奔溃遗留
     */
    private flushActiveInstances;
    /**
     * 新建一个通话记录
     */
    createCall(userId: string): CallState;
    /**
     * 更新状态并标记需要持久化
     */
    updateAgentInstance(userId: string, agentInstanceId: string): void;
    getCallState(userId: string): CallState | undefined;
    /**
     * 结束通话并清理缓存
     */
    removeCall(userId: string): Promise<any>;
    getActiveInstanceId(userId: string): string | undefined;
}
