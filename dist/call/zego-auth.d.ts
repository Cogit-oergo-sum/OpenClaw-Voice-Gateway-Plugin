/**
 * 构造 ZEGO 服务端 API 调用所需的鉴权参数 (Signature, Nonce, Timestamp)
 * @param appId ZEGO AppID
 * @param serverSecret ZEGO ServerSecret
 * @returns 包含 timestamp, nonce, signature 的对象
 */
export declare function generateZegoAuth(appId: number, serverSecret: string): {
    timestamp: number;
    nonce: string;
    signature: string;
};
/**
 * 生成供客户端加入 RTC 房间使用的 Token04
 * @param appId ZEGO AppID
 * @param serverSecret ZEGO ServerSecret
 * @param userId 用户 ID
 * @param effectiveTimeInSeconds Token 有效期 (秒)
 * @param payload 权限 Payload (可选)，默认为空字符串
 * @returns Token 字符串
 */
export declare function generateToken04(appId: number, serverSecret: string, userId: string, effectiveTimeInSeconds?: number, // 默认 24 小时
payload?: string): string;
