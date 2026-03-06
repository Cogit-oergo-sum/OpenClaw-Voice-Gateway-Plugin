"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.CallManager = void 0;
const crypto = __importStar(require("crypto"));
const zego_api_1 = require("./zego-api");
const loader_1 = require("../context/loader");
/**
 * 掌管整个 Plugin 生命周期的状态
 */
class CallManager {
    config;
    activeCalls = new Map();
    api;
    workspaceRoot;
    zombieSweeperTimer;
    // 定时清理僵尸通话的物理最大时限 (毫秒)，默认 1 小时强制切断一切
    MAX_CALL_DURATION_MS = 60 * 60 * 1000;
    constructor(config) {
        this.config = config;
        this.api = new zego_api_1.ZegoApiClient(config.zego);
        this.workspaceRoot = (0, loader_1.resolveWorkspacePath)();
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
    sweepZombies() {
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
    get activeCount() {
        return this.activeCalls.size;
    }
    /**
     * 将目前的活跃实例 ID 集合异步刷写到本地，防奔溃遗留
     */
    async flushActiveInstances() {
        const instances = Array.from(this.activeCalls.values())
            .map(c => c.agentInstanceId)
            .filter(id => !!id);
        try {
            await (0, loader_1.writeWorkspaceJson)(this.workspaceRoot, 'call_states.json', { instances });
        }
        catch (e) {
            console.error('[CallManager] Failed to flush call_states.json', e);
        }
    }
    /**
     * 新建一个通话记录
     */
    createCall(userId) {
        const state = {
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
    updateAgentInstance(userId, agentInstanceId) {
        const call = this.getCallState(userId);
        if (call) {
            call.agentInstanceId = agentInstanceId;
            call.status = 'active';
            this.flushActiveInstances();
        }
    }
    getCallState(userId) {
        return this.activeCalls.get(userId);
    }
    /**
     * 结束通话并清理缓存
     */
    async removeCall(userId) {
        const call = this.activeCalls.get(userId);
        if (!call)
            return null;
        call.status = 'ending';
        let stats = null;
        if (call.agentInstanceId) {
            try {
                stats = await this.api.deleteAgentInstance(call.agentInstanceId);
                console.log(`[CallManager] Deleted agent instance ${call.agentInstanceId}`);
            }
            catch (err) {
                console.error(`[CallManager] Failed to delete agent instance ${call.agentInstanceId}:`, err);
            }
        }
        // Async 落盘 Alias Map (Phase 2 重构的安全 JSON 文件写入)
        if (call.aliasMap.size > 0) {
            console.log(`[CallManager] Persisting ${call.aliasMap.size} aliases to JSON for user ${userId}...`);
            (async () => {
                try {
                    const aliasFileName = 'voice_plugin_aliases.json';
                    let globalAliases = {};
                    const rawData = await (0, loader_1.readWorkspaceFile)(this.workspaceRoot, aliasFileName);
                    if (rawData) {
                        globalAliases = JSON.parse(rawData);
                    }
                    // Merge local into global
                    for (const [k, v] of call.aliasMap.entries()) {
                        globalAliases[k] = v;
                    }
                    await (0, loader_1.writeWorkspaceJson)(this.workspaceRoot, aliasFileName, globalAliases);
                    console.log(`[CallManager] Successfully merged aliases. Total global aliases: ${Object.keys(globalAliases).length}`);
                }
                catch (e) {
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
    getActiveInstanceId(userId) {
        const call = this.getCallState(userId);
        return call?.status === 'active' ? call.agentInstanceId : undefined;
    }
}
exports.CallManager = CallManager;
