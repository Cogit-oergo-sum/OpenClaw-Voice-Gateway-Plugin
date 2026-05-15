import * as dotenv from 'dotenv';
import { IntentRouter } from '../src/agent/intent-router';
import { LatencyTracker } from '../src/utils/latency-tracker';
import { PluginConfig } from '../src/types/config';

dotenv.config();

/**
 * [IntentRouter 优化] 延迟测试脚本
 * 详细测量 IntentRouter 各阶段耗时，对比优化前后效果
 */

// 测试场景
const LATENCY_TEST_CASES = [
    { id: 'CHAT-EMPTY', input: '你好', canvas: 'empty' },
    { id: 'CHAT-TOPIC', input: '今天天气不错', canvas: 'empty' },
    { id: 'TASK-NEW', input: '帮我查一下天气', canvas: 'empty' },
    { id: 'TASK-WITH-CANVAS', input: '帮我整理文件', canvas: 'has_tasks' },
    { id: 'REF-CANVAS', input: '刚才的任务怎么样', canvas: 'has_tasks' },
    { id: 'MULTI-ROUND', input: '取消它', canvas: 'has_tasks' }
];

interface LatencyMetrics {
    testCase: string;
    totalMs: number;
    ttftMs: number | null;
    category: string;
}

async function runLatencyTest(model?: string, iterations: number = 3): Promise<LatencyMetrics[]> {
    const config: PluginConfig = {
        llm: {
            provider: 'openai',
            apiKey: process.env.BAILIAN_API_KEY || process.env.FAST_AGENT_API_KEY || '',
            model: model || 'qwen-turbo',
            baseUrl: process.env.BAILIAN_BASE_URL || process.env.FAST_AGENT_BASE_URL || ''
        },
        tts: { vendor: 'dummy', appId: '', token: '', voiceType: '', resourceId: '' },
        fastAgent: {
            routerModel: model || 'qwen-turbo',
            sleBaseUrl: process.env.BAILIAN_BASE_URL || process.env.FAST_AGENT_BASE_URL
        }
    };

    const router = new IntentRouter(config);
    const metrics: LatencyMetrics[] = [];

    console.log(`\n⏱️ Latency Test (Model: ${model || 'qwen-turbo'}, Iterations: ${iterations})`);
    console.log('='.repeat(60));

    // 简化的 PromptAssembler（用于测试）
    const mockPromptAssembler = {
        assembleSLEPayload: async (scenario: string, callId: string, params: any) => {
            const tasks = params.canvasSnapshot ? JSON.parse(params.canvasSnapshot).tasks : [];
            const hasTasks = tasks.length > 0;

            const systemPrompt = hasTasks
                ? `[Active Tasks] ${tasks.map(t => `${t.id}:${t.name.slice(0,8)}(${t.status})`).join(' ')}
Output JSON: {"r":bool,"i":[]} if answer in canvas, {"i":[{"t":"N/C","n":"<3字名>"}]} if task. NO markdown.`
                : `Output JSON: {"i":[]} if chat, {"i":[{"t":"N","n":"<3字名>"}]} if new task. NO markdown.`;

            return [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: params.text }
            ];
        }
    };

    for (const test of LATENCY_TEST_CASES) {
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const tracker = new LatencyTracker(`test_${test.id}_${i}`, 'LatencyTest');
            tracker.record('ROUTER_START');

            // 模拟画布状态
            const canvasSnapshot = test.canvas === 'has_tasks'
                ? JSON.stringify({ tasks: [{ id: 't_01', name: '测试任务', status: 'PENDING' }] })
                : JSON.stringify({ tasks: [] });

            try {
                await router.detectIntent(
                    test.input,
                    [],
                    mockPromptAssembler as any,
                    `test_${test.id}_${i}`
                );

                tracker.record('ROUTER_END');
                const resultMetrics = tracker.getMetrics();
                latencies.push(resultMetrics.modules.router || 0);

            } catch (e: any) {
                console.error(`[${test.id}] Iteration ${i + 1} failed: ${e.message}`);
                latencies.push(-1);
            }

            // 防止 API 限流
            await new Promise(resolve => setTimeout(resolve, 300));
        }

        // 取平均值（排除失败的）
        const validLatencies = latencies.filter(l => l > 0);
        const avgMs = validLatencies.length > 0
            ? validLatencies.reduce((a, b) => a + b, 0) / validLatencies.length
            : -1;

        metrics.push({
            testCase: test.id,
            totalMs: avgMs,
            ttftMs: avgMs > 0 ? avgMs : null,
            category: test.canvas === 'empty' ? '空画布' : '有画布'
        });

        const status = avgMs <= 100 ? '✅' : (avgMs <= 200 ? '⚠️' : '❌');
        console.log(`${status} [${test.id}] "${test.input}" (${test.canvas}): avg=${avgMs.toFixed(0)}ms`);
    }

    return metrics;
}

// 统计分析
function analyzeMetrics(metrics: LatencyMetrics[]) {
    const emptyCanvas = metrics.filter(m => m.category === '空画布' && m.totalMs > 0);
    const hasCanvas = metrics.filter(m => m.category === '有画布' && m.totalMs > 0);

    const emptyAvg = emptyCanvas.length > 0
        ? emptyCanvas.reduce((a, b) => a + b.totalMs, 0) / emptyCanvas.length
        : -1;

    const hasCanvasAvg = hasCanvas.length > 0
        ? hasCanvas.reduce((a, b) => a + b.totalMs, 0) / hasCanvas.length
        : -1;

    return { emptyAvg, hasCanvasAvg };
}

// 主函数
async function main() {
    const model = process.argv[2] || process.env.ROUTER_MODEL;
    const iterations = parseInt(process.argv[3] || '3');

    if (!process.env.BAILIAN_API_KEY && !process.env.FAST_AGENT_API_KEY) {
        console.error('❌ Missing API key. Please set BAILIAN_API_KEY or FAST_AGENT_API_KEY');
        process.exit(1);
    }

    console.log('🚀 IntentRouter Latency Benchmark');
    console.log('='.repeat(60));

    const metrics = await runLatencyTest(model, iterations);
    const analysis = analyzeMetrics(metrics);

    console.log('\n' + '='.repeat(60));
    console.log('📊 ANALYSIS');
    console.log('='.repeat(60));

    console.log(`\n| Category | Avg Latency | Target | Status |`);
    console.log(`|----------|-------------|--------|--------|`);

    const emptyStatus = analysis.emptyAvg <= 100 ? '✅ PASS' : (analysis.emptyAvg <= 200 ? '⚠️ OK' : '❌ FAIL');
    const hasStatus = analysis.hasCanvasAvg <= 200 ? '✅ PASS' : '❌ FAIL';

    console.log(`| 空画布(闲聊) | ${analysis.emptyAvg.toFixed(0)}ms | ≤100ms | ${emptyStatus} |`);
    console.log(`| 有画布(任务) | ${analysis.hasCanvasAvg.toFixed(0)}ms | ≤200ms | ${hasStatus} |`);

    // 判断是否达标
    const meetsTarget = analysis.emptyAvg > 0 && analysis.emptyAvg <= 100 &&
                       analysis.hasCanvasAvg > 0 && analysis.hasCanvasAvg <= 200;

    if (meetsTarget) {
        console.log('\n✅ Latency targets met!');
    } else {
        console.log('\n⚠️ Latency targets not fully met. Consider further optimization.');
    }

    // 输出优化建议
    if (analysis.emptyAvg > 100) {
        console.log('\n💡 Suggestions for empty canvas optimization:');
        console.log('   - Use minimal router prompt (remove skill list, archive)');
        console.log('   - Consider switching to faster model (qwen3-8b)');
        console.log('   - Enable KV Cache for static prompt parts');
    }

    if (analysis.hasCanvasAvg > 200) {
        console.log('\n💡 Suggestions for canvas optimization:');
        console.log('   - Simplify canvas state format');
        console.log('   - Remove archive memory injection from ROUTING');
        console.log('   - Use KV Cache for skill list');
    }

    process.exit(0);
}

main().catch(e => {
    console.error('FATAL ERROR:', e);
    process.exit(1);
});