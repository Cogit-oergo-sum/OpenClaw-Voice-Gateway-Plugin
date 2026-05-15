/**
 * [V3.7.2] LatencyTracker: 耗时追踪工具
 * 职责：精确记录从 ASR 接收到首句 TTS 发出及中间各级 LLM 调用的耗时，用于性能调优。
 */
export class LatencyTracker {
    private times: Map<string, number> = new Map();
    private ttft: number | null = null;
    private firstSentenceTime: number | null = null;

    constructor(public callId: string, public source: string = 'User-Input') {
        this.record('ASR_RECV');
    }

    /**
     * 记录特定检查点的时间戳
     */
    record(name: string) {
        this.times.set(name, Date.now());
    }

    /**
     * 记录首字输出 (TTFT)
     */
    recordTTFT() {
        if (!this.ttft) {
            this.ttft = Date.now();
        }
    }

    /**
     * 记录首句输出 (用于评估 TTS 启动耗时)
     */
    recordFirstSentence() {
        if (!this.firstSentenceTime) {
            this.firstSentenceTime = Date.now();
        }
    }

    /**
     * 获取耗时报表 (结构化，供前端展示)
     */
    getMetrics(): any {
        const asrRecv = this.times.get('ASR_RECV') || 0;
        const now = Date.now();

        const getVal = (name: string) => this.times.get(name);
        const getDur = (start: string, end: string) => {
            const s = getVal(start);
            const e = getVal(end);
            return (s && e) ? (e - s) : null;
        };

        return {
            asr_recv_at: asrRecv,
            total: now - asrRecv,
            ttft: this.ttft ? (this.ttft - asrRecv) : null,
            first_sentence: this.firstSentenceTime ? (this.firstSentenceTime - asrRecv) : null,
            modules: {
                router: getDur('ROUTER_START', 'ROUTER_END'),
                slc: getDur('SLC_START', 'SLC_END'),
                sle: getDur('SLE_START', 'SLE_END'),
                tool: getDur('TOOL_START', 'TOOL_END'),
                summarize: getDur('SUMMARIZE_START', 'SUMMARIZE_END')
            }
        };
    }

    /**
     * 获取耗时报表
     */
    getSummary(): string {
        const metrics = this.getMetrics();
        return `
[Latency Report][${this.callId}][${this.source}]
------------------------------------------------
1. 全链路耗时:
   - ASR -> 首字 (TTFT): ${metrics.ttft ?? 'N/A'}ms
   - ASR -> 首句 (TTS Ready): ${metrics.first_sentence ?? 'N/A'}ms
   - ASR -> 全程结束: ${metrics.total}ms

2. LLM 拆解耗时:
   - IntentRouter: ${metrics.modules.router ?? 'N/A'}ms
   - SLC (交互引擎): ${metrics.modules.slc ?? 'N/A'}ms
   - SLE (逻辑分析): ${metrics.modules.sle ?? 'N/A'}ms
   - Tool (工具执行): ${metrics.modules.tool ?? 'N/A'}ms
   - Summarize (结果提纯): ${metrics.modules.summarize ?? 'N/A'}ms
------------------------------------------------`.trim();
    }
}
