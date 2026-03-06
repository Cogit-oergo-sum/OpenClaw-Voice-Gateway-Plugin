import { CallManager } from '../call/call-manager';
import { generateToken04 } from '../call/zego-auth';
import type { ZegoConfig } from '../types/config';
import { RateLimiter } from '../utils/rate-limiter';

// 全局单例限流器：单 UserId 限制 1 分钟最多发起 3 次通话
const startCallLimiter = new RateLimiter(60000, 3);

export function startCallHandler(manager: CallManager, config: ZegoConfig) {
    return async (req: any, res: any) => {
        try {
            const { userId } = req.body;
            if (!userId) {
                return res.status(400).json({ error: 'Missing userId' });
            }

            // 1. 滑窗限流防御 (防刷接口)
            if (!startCallLimiter.isAllowed(userId)) {
                return res.status(429).json({ error: 'Too Many Requests: Rate limit exceeded for this user' });
            }

            // 2. 并发槽位熔断 (防打爆 ZEGO 并发及扣费)
            // 读取用户在 config.schema.json 里配置的最大并发，默认 8
            const maxConcurrent = manager.config.advanced?.maxConcurrentCalls ?? 8;
            if (manager.activeCount >= maxConcurrent) {
                return res.status(429).json({ error: 'Too Many Requests: System concurrent capacity reached' });
            }

            // 3. 防并发双击覆写
            if (manager.getCallState(userId)) {
                return res.status(409).json({ error: 'Conflict: User already has an active call' });
            }

            // 4. 在 CallManager 中创建新的状态机实例
            const callState = manager.createCall(userId);
            const roomId = `room_${userId}_${Date.now()}`;
            const agentStreamId = `agent_${userId}_out`;
            const userStreamId = `user_${userId}_in`;

            let agentInstanceId: string;
            try {
                // 5. 调用 ZEGO AI Agent 服务端 API 创建实例
                // 注意：ZEGO 官方要求真实 RTC roomId, userId
                agentInstanceId = await manager.api.createAgentInstance(roomId, userId, agentStreamId);
            } catch (createError) {
                // 核心修复: 立即清理由于建联失败占用的本地并发坑位，防永久死锁
                await manager.removeCall(userId);
                throw createError; // 继续抛出让最外层 catch 捕获并返回 500
            }

            // 6. 更新内存状态
            callState.agentInstanceId = agentInstanceId;
            callState.roomId = roomId;
            callState.userStreamId = userStreamId;
            callState.agentStreamId = agentStreamId;
            callState.status = 'active';

            // 7. 生成客户端加入房间所需的 RTC Token04
            const token = generateToken04(config.appId, config.serverSecret, userId);

            res.json({
                roomId,
                token,
                agentInstanceId,
                agentUserId: 'openclaw_voice_agent',
                agentStreamId,
                userStreamId,
                // 下发专属防越权通信 Token
                controlToken: callState.controlToken
            });
        } catch (error: any) {
            console.error('[startCallHandler] Error:', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export function endCallHandler(manager: CallManager) {
    return async (req: any, res: any) => {
        try {
            // 需要控制者提供 userId 及专属的 controlToken 以供鉴权
            const { userId, controlToken } = req.body;
            if (!userId) {
                return res.status(400).json({ error: 'Missing userId' });
            }
            if (!controlToken) {
                return res.status(401).json({ error: 'Missing controlToken. Unauthorized' });
            }

            const state = manager.getCallState(userId);
            if (!state) {
                return res.status(404).json({ error: 'Active call not found' });
            }

            // 防越权鉴权
            if (state.controlToken !== controlToken) {
                return res.status(403).json({ error: 'Forbidden: Invalid controlToken' });
            }

            // 执行真正清理
            const stats = await manager.removeCall(userId);

            res.json({ success: true, stats });
        } catch (error: any) {
            console.error('[endCallHandler] Error:', error);
            res.status(500).json({ error: error.message });
        }
    };
}

export function statusHandler(manager: CallManager) {
    return async (req: any, res: any) => {
        const { userId } = req.query;
        if (!userId) {
            return res.status(400).json({ error: 'Missing userId query parameter' });
        }

        const state = manager.getCallState(userId as string);
        if (!state) {
            return res.json({ status: 'idle' });
        }

        res.json({
            status: state.status,
            roomId: state.roomId,
            agentInstanceId: state.agentInstanceId,
            durationSeconds: Math.floor((Date.now() - state.startTime.getTime()) / 1000)
        });
    };
}

export function refreshTokenHandler(manager: CallManager, config: ZegoConfig) {
    return async (req: any, res: any) => {
        try {
            // 安全起见，刷新 Token 必须通过原建联时下发的 controlToken
            const { userId, controlToken } = req.body;
            if (!userId || !controlToken) {
                return res.status(400).json({ error: 'Missing userId or controlToken' });
            }

            const state = manager.getCallState(userId);
            if (!state || state.controlToken !== controlToken) {
                return res.status(403).json({ error: 'Forbidden: Invalid controlToken or active call not found' });
            }

            // 续发新的 1 小时 Token04
            const token = generateToken04(config.appId, config.serverSecret, userId);
            res.json({ success: true, token });
        } catch (error: any) {
            console.error('[refreshTokenHandler] Error:', error);
            res.status(500).json({ error: error.message });
        }
    };
}
