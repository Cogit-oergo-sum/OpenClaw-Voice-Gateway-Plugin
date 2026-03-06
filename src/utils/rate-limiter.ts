/**
 * 极简的基于内存的滑动窗口限流器
 * 用于防御恶意刷单和风暴建联
 */
export class RateLimiter {
    private records = new Map<string, number[]>();
    private cleanupTimer: NodeJS.Timeout;

    /**
     * @param windowMs 时间窗口 (毫秒)
     * @param maxRequests 窗口内最大允许请求数
     */
    constructor(private windowMs: number = 60000, private maxRequests: number = 3) {
        // 防止 OOM 定时清理（例如每隔时间窗口的 2 倍触发一次全量清理）
        this.cleanupTimer = setInterval(() => this.cleanup(), this.windowMs * 2);
    }

    /**
     * 自动清除过期键，防止恶意刷不同 UserId 造成 Node.js 内存溢出 (OOM)
     */
    private cleanup() {
        const now = Date.now();
        for (const [key, timestamps] of this.records.entries()) {
            const valid = timestamps.filter(ts => now - ts < this.windowMs);
            if (valid.length === 0) {
                this.records.delete(key);
            } else {
                this.records.set(key, valid);
            }
        }
    }

    /**
     * 停止限流器（供测试或插件卸载时使用）
     */
    destroy() {
        clearInterval(this.cleanupTimer);
    }

    isAllowed(key: string): boolean {
        const now = Date.now();
        const timestamps = this.records.get(key) || [];

        // 过滤掉不在窗口期内的时间戳
        const validTimestamps = timestamps.filter(ts => now - ts < this.windowMs);

        if (validTimestamps.length >= this.maxRequests) {
            this.records.set(key, validTimestamps);
            return false;
        }

        validTimestamps.push(now);
        this.records.set(key, validTimestamps);
        return true;
    }
}
