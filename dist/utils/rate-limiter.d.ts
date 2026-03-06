/**
 * 极简的基于内存的滑动窗口限流器
 * 用于防御恶意刷单和风暴建联
 */
export declare class RateLimiter {
    private windowMs;
    private maxRequests;
    private records;
    private cleanupTimer;
    /**
     * @param windowMs 时间窗口 (毫秒)
     * @param maxRequests 窗口内最大允许请求数
     */
    constructor(windowMs?: number, maxRequests?: number);
    /**
     * 自动清除过期键，防止恶意刷不同 UserId 造成 Node.js 内存溢出 (OOM)
     */
    private cleanup;
    /**
     * 停止限流器（供测试或插件卸载时使用）
     */
    destroy(): void;
    isAllowed(key: string): boolean;
}
