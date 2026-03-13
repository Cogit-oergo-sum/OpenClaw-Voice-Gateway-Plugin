import * as crypto from 'crypto';
import { generateToken04 as internalGenerateToken04 } from './zego/token/zegoServerAssistant';

/**
 * 构造 ZEGO 服务端 API 调用所需的鉴权参数 (Signature, Nonce, Timestamp)
 * @param appId ZEGO AppID
 * @param serverSecret ZEGO ServerSecret
 * @returns 包含 timestamp, nonce, signature 的对象
 */
export function generateZegoAuth(appId: number, serverSecret: string) {
    // 1. 获取当前时间戳 (秒)
    const timestamp = Math.floor(Date.now() / 1000);

    // 2. 生成 16 字符的随机 Hex 字符串作为 Nonce (8 bytes = 16 hex chars)
    const nonce = crypto.randomBytes(8).toString('hex');

    // 3. 按照 AppId + SignatureNonce + ServerSecret + Timestamp 的顺序拼装字符串
    const rawString = `${appId}${nonce}${serverSecret}${timestamp}`;

    // 4. 计算 MD5 哈希值，并转为小写 hex 字符串
    const signature = crypto.createHash('md5').update(rawString).digest('hex').toLowerCase();

    return {
        timestamp,
        nonce,
        signature
    };
}

/**
 * 生成供客户端加入 RTC 房间使用的 Token04
 * @param appId ZEGO AppID
 * @param serverSecret ZEGO ServerSecret
 * @param userId 用户 ID
 * @param effectiveTimeInSeconds Token 有效期 (秒)
 * @param payload 权限 Payload (可选)，默认为空字符串
 * @returns Token 字符串
 */
export function generateToken04(
    appId: number,
    serverSecret: string,
    userId: string,
    effectiveTimeInSeconds: number = 3600 * 24, // 默认 24 小时
    payload: string = ''
): string {
    return internalGenerateToken04(appId, userId, serverSecret, effectiveTimeInSeconds, payload);
}
