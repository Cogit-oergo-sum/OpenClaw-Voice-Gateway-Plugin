import { CallManager } from '../call/call-manager';

/**
 * 模拟主 Agent 回调接口 (Mock Webhook Callback)
 * 用于演示当主 Agent 完成耗时任务后，如何异步“插播”语音给用户。
 */
export function mockCallbackHandler(manager: CallManager) {
    return async (req: any, res: any) => {
        const { text, status, userId } = req.body;
        console.log(`[MockWebhook] Received task completion: ${status}. Text: ${text}`);

        // 查找最近活跃的通话，准备“插播”
        const tgtUserId = userId || Array.from(manager['activeCalls'].keys())[0];
        if (!tgtUserId) {
            res.status(404).json({ error: 'No active call found to notify' });
            return;
        }

        const activeInstanceId = manager.getActiveInstanceId(tgtUserId);
        if (activeInstanceId) {
            try {
                // 调用 ZEGO TTS 插播 (异步插播，优先级 High)
                await manager.api.sendAgentInstanceTTS(
                    activeInstanceId, 
                    `(语气轻快) 先生，插播一条消息：${text}`, 
                    'High', 
                    'Enqueue'
                );
                res.json({ success: true, message: 'Notification injected to voice stream' });
            } catch (err: any) {
                res.status(500).json({ error: err.message });
            }
        } else {
            // 如果没通话，就仅记录 (模拟文本通知)
            console.log(`[MockWebhook] No active call for ${tgtUserId}, logging result: ${text}`);
            res.json({ success: true, message: 'Result logged (No active call)' });
        }
    };
}
