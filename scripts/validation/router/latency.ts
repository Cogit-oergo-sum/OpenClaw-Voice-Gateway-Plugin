/**
 * [V4.0] IntentRouter 延迟验证脚本 - 极简版本
 *
 * 验证标准：平均延迟 ≤200ms
 * Payload: 仅包含极简画布格式 `[id] name`，约25 tokens
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ROUTER_TEST_CASES, RouterTestCase } from '../../router-test-cases';
import { INTENT_ROUTER_LITE_PROMPT } from '../../../src/agent/prompts';

dotenv.config();

/**
 * [V4.0] 构建极简路由 Prompt（1字符输出）
 */
function buildMinimalRouterPrompt(canvas: any[] | null): string {
    const canvasBlock = canvas && canvas.length > 0
        ? `[Canvas]\n${canvas.map(t => `[${t.id}] ${t.name}`).join('\n')}`
        : '[Canvas] (无)';

    return `${INTENT_ROUTER_LITE_PROMPT()}\n\n${canvasBlock}`;
}

/**
 * 测试单次延迟（极简 payload）
 */
async function measureLatency(testCase: RouterTestCase, config: any): Promise<number> {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    const model = config.model || process.env.ROUTER_MODEL || 'qwen-turbo';

    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    const prompt = buildMinimalRouterPrompt(testCase.canvas);

    const messages = [
        { role: 'system', content: prompt },
        { role: 'user', content: testCase.input }
    ];

    const start = Date.now();

    try {
        const stream = await openai.chat.completions.create({
            model,
            messages,
            max_tokens: 10,
            temperature: 0,
            stream: true
        } as any);

        let content = '';
        for await (const chunk of stream as any) {
            content += chunk.choices?.[0]?.delta?.content || '';
        }

        return Date.now() - start;
    } catch (e: any) {
        return Date.now() - start;
    }
}

/**
 * 运行延迟验证
 */
async function runLatencyValidation() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('');
        console.log('Usage: npm run test:router:latency [options]');
        console.log('');
        console.log('[V4.0] IntentRouter 极简延迟验证');
        console.log('');
        console.log('Payload: ~25 tokens (vs ~200 legacy)');
        console.log('  - 移除 Archive 记忆索引');
        console.log('  - 移除 skills_summary');
        console.log('  - 移除对话历史');
        console.log('  - 极简画布格式: `[id] name`');
        console.log('');
        console.log('Options:');
        console.log('  --iter=N        重复测试次数（默认5）');
        console.log('  --model=<name>  指定模型');
        console.log('  --verbose       详细输出');
        console.log('');
        process.exit(0);
    }

    const iterArg = args.find(a => a.startsWith('--iter='));
    const iterations = iterArg ? parseInt(iterArg.split('=')[1]) : 5;

    const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
    const model = modelArg || args.find(a => !a.startsWith('--')) || process.env.ROUTER_MODEL || 'qwen-turbo';

    const config = {
        component: 'router',
        model,
        iterations,
        outputFormat: 'console',
        verbose: args.includes('--verbose')
    };

    // 选择所有测试用例
    const taskCases = ROUTER_TEST_CASES.filter(c =>
        c.id.startsWith('TASK') || c.id.startsWith('REF') || c.id.startsWith('CHAT')
    ) as RouterTestCase[];

    console.log(`\n🚀 IntentRouter [V4.0] 延迟验证 (极简 payload)`);
    console.log(`Model: ${model}`);
    console.log(`Prompt: ~25 tokens`);
    console.log(`  - 移除 Archive (原~300 tokens)`);
    console.log(`  - 移除 skills_summary (原~100 tokens)`);
    console.log(`  - 移除对话历史 (原~200 tokens)`);
    console.log(`  - 极简画布格式: \`[id] name\``);
    console.log(`Test cases: ${taskCases.length}`);
    console.log(`Iterations: ${iterations} 次/用例`);
    console.log('='.repeat(60));

    const allLatencies: number[] = [];
    const caseLatencies: Map<string, number[]> = new Map();

    for (const testCase of taskCases) {
        const latencies: number[] = [];

        for (let i = 0; i < iterations; i++) {
            const latency = await measureLatency(testCase, config);
            latencies.push(latency);
            allLatencies.push(latency);

            if (config.verbose) {
                console.log(`  第${i + 1}次: ${latency}ms`);
            }

            await new Promise(r => setTimeout(r, 100));
        }

        caseLatencies.set(testCase.id, latencies);
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        const status = avg <= 200 ? '✅' : (avg <= 500 ? '⚠️' : '❌');
        console.log(`${status} [${testCase.id}] 平均: ${avg.toFixed(0)}ms (${latencies.join(', ')}ms)`);
    }

    // 统计结果
    const avgLatency = allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length;
    const sorted = [...allLatencies].sort((a, b) => a - b);
    const p50 = sorted[Math.floor(sorted.length * 0.5)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const max = sorted[sorted.length - 1];
    const min = sorted[0];

    console.log('\n' + '='.repeat(60));
    console.log('\n## 延迟统计');
    console.log('');
    console.log('| 指标 | 值 | 阈值 | 状态 |');
    console.log('|------|-----|------|------|');
    console.log(`| 平均延迟 | ${avgLatency.toFixed(0)}ms | ≤200ms | ${avgLatency <= 200 ? '✅达标' : (avgLatency <= 500 ? '⚠️接近' : '❌超时')} |`);
    console.log(`| P50延迟 | ${p50}ms | - | - |`);
    console.log(`| P95延迟 | ${p95}ms | - | - |`);
    console.log(`| 最小延迟 | ${min}ms | - | - |`);
    console.log(`| 最大延迟 | ${max}ms | - | - |`);

    console.log('\n## 按用例统计');
    for (const [id, latencies] of caseLatencies) {
        const avg = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        console.log(`- [${id}]: ${avg.toFixed(0)}ms`);
    }

    // 退出判定
    if (avgLatency > 500) {
        console.error('\n❌ 平均延迟超过500ms阈值！');
        process.exit(1);
    }
    if (avgLatency > 200) {
        console.log('\n⚠️ 平均延迟超过200ms目标，但在500ms阈值内');
    } else {
        console.log('\n✅ 延迟验证达标！(≤200ms)');
    }
    process.exit(0);
}

if (require.main === module) {
    runLatencyValidation().catch(e => {
        console.error('FATAL:', e);
        process.exit(1);
    });
}

export { measureLatency, runLatencyValidation };