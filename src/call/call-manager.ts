// CallState 及 CallManager 内部实现
export interface CallState {
    userId: string;
    agentInstanceId?: string;
    roomId?: string;
    agentUserId?: string;
    agentStreamId?: string;
    userStreamId?: string;
    startTime: Date;
    status: 'creating' | 'active' | 'ending';

    // 安全防越权 Token
    controlToken: string;

    // 缓存相关的上下文内容
    cachedPromptPrefix: string;
    cachedPromptSuffix: string;
    memoryMtime: number;

    // ASR 纠错与缓存
    dynamicHotwords: string[];
    aliasMap: Map<string, string>;

    // 内存缓冲区 (延时落盘)
    conversationBuffer: Array<{ role: string; content: string }>;
}

import * as crypto from 'crypto';
import { ZegoApiClient } from './zego-api';
import type { PluginConfig } from '../types/config';
import { resolveWorkspacePath, writeWorkspaceJson, appendWorkspaceFile, readWorkspaceFile } from '../context/loader';

/**
 * 掌管整个 Plugin 生命周期的状态
 */
export class CallManager {
    private activeCalls = new Map<string, CallState>();
    public api: ZegoApiClient;
    public workspaceRoot: string;
    private zombieSweeperTimer: NodeJS.Timeout;

    // 定时清理僵尸通话的物理最大时限 (毫秒)，默认 1 小时强制切断一切
    private readonly MAX_CALL_DURATION_MS = 60 * 60 * 1000;

    constructor(public config: PluginConfig) {
        this.api = new ZegoApiClient(config.zego);
        this.workspaceRoot = resolveWorkspacePath();

        // 挂载一个每 5 分钟轮询一次的僵尸清扫器
        this.zombieSweeperTimer = setInterval(() => this.sweepZombies(), 5 * 60 * 1000);
    }

    /**
     * 停止 Manager 内所有的资源和轮询（方便单元测试和卸载）
     */
    destroy() {
        clearInterval(this.zombieSweeperTimer);
    }

    /**
     * 每 5 分钟扫描一次内存 map。
     * 检测到超过物理连接上限、因客户端断网未能调用 end-call 成为僵尸的 Call，主动发车销毁。
     */
    private sweepZombies() {
        const now = Date.now();
        for (const [userId, call] of this.activeCalls.entries()) {
            if (now - call.startTime.getTime() > this.MAX_CALL_DURATION_MS) {
                console.warn(`[CallManager] 🧟 Zombie Instance Detected for userId: ${userId} (Duration > 1h). Forcing Terminate & GC.`);
                this.removeCall(userId).catch(e => {
                    console.error(`[CallManager] Failed to collect zombie call for ${userId}`, e);
                });
            }
        }
    }

    /**
     * 当前并发活跃数
     */
    get activeCount(): number {
        return this.activeCalls.size;
    }

    /**
     * 将目前的活跃实例 ID 集合异步刷写到本地，防奔溃遗留
     */
    private async flushActiveInstances(): Promise<void> {
        const instances = Array.from(this.activeCalls.values())
            .map(c => c.agentInstanceId)
            .filter(id => !!id);

        try {
            await writeWorkspaceJson(this.workspaceRoot, 'call_states.json', { instances });
        } catch (e) {
            console.error('[CallManager] Failed to flush call_states.json', e);
        }
    }

    /**
     * 新建一个通话记录
     */
    createCall(userId: string): CallState {
        const state: CallState = {
            userId,
            startTime: new Date(),
            status: 'creating',
            controlToken: crypto.randomUUID(), // 一次性强随机 Token
            cachedPromptPrefix: '',
            cachedPromptSuffix: '',
            memoryMtime: 0,
            dynamicHotwords: [],
            aliasMap: new Map(),
            conversationBuffer: []
        };
        this.activeCalls.set(userId, state);

        // 标记：异步写入当前活跃列表，不用 await
        this.flushActiveInstances();

        return state;
    }

    /**
     * 更新状态并标记需要持久化
     */
    updateAgentInstance(userId: string, agentInstanceId: string) {
        const call = this.getCallState(userId);
        if (call) {
            call.agentInstanceId = agentInstanceId;
            call.status = 'active';
            this.flushActiveInstances();
        }
    }

    getCallState(userId: string): CallState | undefined {
        return this.activeCalls.get(userId);
    }

    /**
     * 结束通话并清理缓存
     */
    async removeCall(userId: string): Promise<any> {
        const call = this.activeCalls.get(userId);
        if (!call) return null;

        call.status = 'ending';
        let stats = null;

        if (call.agentInstanceId) {
            try {
                stats = await this.api.deleteAgentInstance(call.agentInstanceId);
                console.log(`[CallManager] Deleted agent instance ${call.agentInstanceId}`);
            } catch (err) {
                console.error(`[CallManager] Failed to delete agent instance ${call.agentInstanceId}:`, err);
            }
        }

        // Async 落盘 Alias Map (Phase 2 重构的安全 JSON 文件写入)
        if (call.aliasMap.size > 0) {
            console.log(`[CallManager] Persisting ${call.aliasMap.size} aliases to JSON for user ${userId}...`);
            (async () => {
                try {
                    const aliasFileName = 'voice_plugin_aliases.json';
                    let globalAliases: Record<string, string> = {};
                    const rawData = await readWorkspaceFile(this.workspaceRoot, aliasFileName);
                    if (rawData) {
                        globalAliases = JSON.parse(rawData);
                    }

                    // Merge local into global
                    for (const [k, v] of call.aliasMap.entries()) {
                        globalAliases[k] = v;
                    }

                    await writeWorkspaceJson(this.workspaceRoot, aliasFileName, globalAliases);
                    console.log(`[CallManager] Successfully merged aliases. Total global aliases: ${Object.keys(globalAliases).length}`);
                } catch (e) {
                    console.error('[CallManager] Failed to persist alias map for user', e);
                }
            })();
        }

        // TODO Phase 2: 将 conversationBuffer 写入内存文件 (这一步将在下一步 chat-api 中完善)
        console.log(`[CallManager] Archiving conversation logs for user ${userId}...`);

        this.activeCalls.delete(userId);
        this.flushActiveInstances();

        return stats;
    }

    getActiveInstanceId(userId: string): string | undefined {
        const call = this.getCallState(userId);
        return call?.status === 'active' ? call.agentInstanceId : undefined;
    }
}
