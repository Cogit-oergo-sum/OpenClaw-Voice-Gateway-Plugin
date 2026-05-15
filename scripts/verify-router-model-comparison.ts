import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { PluginConfig } from '../src/types/config';

dotenv.config();

/**
 * [IntentRouter 优化] 模型对比测试脚本
 * 对比 qwen-turbo、qwen3-14b（关闭思考）、qwen3-8b 的延迟与准确率
 */

// 测试用例（包含画布状态模拟）
const QUICK_TEST_SUITE = [
    { id: 'CHAT-01', input: '你好', canvasState: null, expectedIntent: null },
    { id: 'CHAT-02', input: '今天天气不错', canvasState: null, expectedIntent: null },
    { id: 'TASK-01', input: '帮我查一下天气', canvasState: null, expectedIntent: 'NEW_TASK' },
    { id: 'TASK-02', input: '创建一个文档', canvasState: null, expectedIntent: 'NEW_TASK' },
    { id: 'MULTI-01', input: '取消它', canvasState: 't_01:创建test.md(PENDING)', expectedIntent: 'CANCEL_TASK' },
    { id: 'MULTI-02', input: '结果怎么样', canvasState: 't_01:天气查询(READY)', expectedIntent: 'CANVAS_REF' },
    { id: 'REF-01', input: '刚才的任务怎么样', canvasState: 't_01:天气查询(READY)', expectedIntent: 'CANVAS_REF' },
    { id: 'CANCEL-01', input: '取消刚才的任务', canvasState: 't_01:后台任务(PENDING)', expectedIntent: 'CANCEL_TASK' }
];

// 构造带画布状态的路由 Prompt
function buildRouterPrompt(canvasState: string | null): string {
    if (!canvasState) {
        // 空画布场景：极简 Prompt，仅区分闲聊和新任务
        return `[Intent Router]
判断用户意图并输出 JSON：
- 纯闲聊/打招呼 → {"i":[]}
- 需执行操作（查、建、删、整理等）→ {"i":[{"t":"N","n":"<简短任务名>"}]}

示例：
"你好" → {"i":[]}
"帮我查天气" → {"i":[{"t":"N","n":"天气"}]}
严禁输出 markdown，直接输出纯 JSON。`;
    } else {
        // 有画布场景：包含画布状态，支持引用和取消
        return `[Intent Router]
[Active Canvas] ${canvasState}

判断用户意图并输出 JSON：
- 纯闲聊 → {"i":[]}
- 询问画布中任务的结果/状态 → {"r":true}
- 新任务 → {"i":[{"t":"N","n":"<简短名>"}]}
- 取消画布中的任务 → {"i":[{"t":"C"}]}

示例：
"刚才的任务怎么样" → {"r":true}
"取消它" → {"i":[{"t":"C"}]}
严禁输出 markdown，直接输出纯 JSON。`;
    }
}

interface ModelTestResult {
    model: string;
    avgLatency: number;
    p95Latency: number;
    accuracy: number;
    multiRoundAccuracy: number;
    errors: string[];
}

// 测试单个模型
async function testModel(modelId: string, config: { apiKey: string; baseUrl: string }): Promise<ModelTestResult> {
    const openai = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl
    });

    const latencyResults: number[] = [];
    const accuracyResults: boolean[] = [];
    const multiRoundResults: boolean[] = [];
    const errors: string[] = [];

    console.log(`\n🧪 Testing model: ${modelId}`);
    console.log('-'.repeat(40));

    for (const test of QUICK_TEST_SUITE) {
        const start = Date.now();

        try {
            // 根据画布状态构建不同的 Prompt
            const systemPrompt = buildRouterPrompt(test.canvasState);

            // 构造消息
            const messages: any[] = [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: test.input }
            ];

            // 构造请求参数（支持流式输出）
            const requestParams: any = {
                model: modelId,
                messages,
                response_format: { type: 'json_object' },
                max_tokens: 50,
                temperature: 0,
                stream: true  // 启用流式输出降低 TTFT
            };

            // 百炼 qwen3 系列强制要求：非流式调用必须设置 enable_thinking: false
            // 流式模式下默认就是关闭思考的，但显式设置也可以
            if (modelId.includes('qwen3')) {
                requestParams.enable_thinking = false;
            }

            // 流式调用需要使用 SDK 的流式类型
            const streamResponse = await openai.chat.completions.create(requestParams as any) as any;

            // 收集流式输出
            let content = '';
            const firstTokenTime = Date.now() - start;  // TTFT

            // OpenAI SDK 流式遍历
            for await (const chunk of streamResponse) {
                const delta = chunk.choices?.[0]?.delta?.content || '';
                content += delta;
            }

            const latency = Date.now() - start;  // 总延迟
            latencyResults.push(latency);

            // 解析流式收集的内容
            let result: any;
            try {
                result = JSON.parse(content);
            } catch {
                errors.push(`[${test.id}] JSON parse failed: ${content}`);
                accuracyResults.push(false);
                continue;
            }

            // 判断意图类型
            const intents = result.i || result.intents || [];
            const intentType = intents[0]?.t || intents[0]?.type;
            const isCanvasRef = result.r || result.isAnswerInCanvas;

            // 验证准确性
            let correct = false;
            if (test.expectedIntent === null) {
                correct = intents.length === 0;
            } else if (test.expectedIntent === 'NEW_TASK') {
                correct = intentType === 'N' || intentType === 'NEW_TASK';
            } else if (test.expectedIntent === 'CANCEL_TASK') {
                correct = intentType === 'C' || intentType === 'CANCEL_TASK';
            } else if (test.expectedIntent === 'CANVAS_REF') {
                correct = isCanvasRef === true;
            }

            accuracyResults.push(correct);
            // 多轮场景：有画布状态的测试
            if (test.canvasState) multiRoundResults.push(correct);

            const status = correct ? '✅' : '❌';
            console.log(`${status} [${test.id}] "${test.input}" → ${latency}ms`);

            if (!correct) {
                console.log(`   Expected: ${test.expectedIntent}, Got: ${JSON.stringify(result)}`);
            }

        } catch (e: any) {
            const latency = Date.now() - start;
            latencyResults.push(latency);
            const errorMsg = e.message || e.error?.message || JSON.stringify(e);
            errors.push(`[${test.id}] Error: ${errorMsg}`);
            accuracyResults.push(false);
            console.log(`💥 [${test.id}] "${test.input}" → ${latency}ms (ERROR: ${errorMsg.slice(0, 100)})`);
        }

        // 防止 API 限流
        await new Promise(resolve => setTimeout(resolve, 300));
    }

    // 计算统计数据
    const avgLatency = latencyResults.reduce((a, b) => a + b, 0) / latencyResults.length;
    const sortedLatency = [...latencyResults].sort((a, b) => a - b);
    const p95Latency = sortedLatency[Math.floor(sortedLatency.length * 0.95)] || sortedLatency[sortedLatency.length - 1];
    const accuracy = accuracyResults.filter(r => r).length / accuracyResults.length;
    const multiRoundAccuracy = multiRoundResults.length > 0
        ? multiRoundResults.filter(r => r).length / multiRoundResults.length
        : 1;

    return {
        model: modelId,
        avgLatency,
        p95Latency,
        accuracy,
        multiRoundAccuracy,
        errors
    };
}

// 主函数
async function main() {
    const apiKey = process.env.BAILIAN_API_KEY || process.env.FAST_AGENT_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || process.env.FAST_AGENT_BASE_URL || '';

    if (!apiKey || !baseUrl) {
        console.error('❌ Missing API key or base URL. Please set BAILIAN_API_KEY and BAILIAN_BASE_URL');
        process.exit(1);
    }

    // 测试模型列表
    const modelsToTest = [
        'qwen-turbo',           // 当前默认
        'qwen3-14b',            // 推荐替换
        'qwen3-8b',             // 极速场景
    ];

    // 支持命令行指定模型
    const customModel = process.argv[2];
    if (customModel) {
        modelsToTest.length = 0;
        modelsToTest.push(customModel);
    }

    console.log('🚀 IntentRouter Model Comparison Test');
    console.log('='.repeat(60));
    console.log(`API Base: ${baseUrl}`);
    console.log(`Models to test: ${modelsToTest.join(', ')}`);

    const results: ModelTestResult[] = [];

    for (const model of modelsToTest) {
        try {
            const result = await testModel(model, { apiKey, baseUrl });
            results.push(result);
        } catch (e: any) {
            console.error(`\n💥 Failed to test model ${model}: ${e.message}`);
            results.push({
                model,
                avgLatency: -1,
                p95Latency: -1,
                accuracy: 0,
                multiRoundAccuracy: 0,
                errors: [`Model test failed: ${e.message}`]
            });
        }
    }

    // 打印对比结果
    console.log('\n' + '='.repeat(60));
    console.log('📊 COMPARISON RESULTS');
    console.log('='.repeat(60));

    console.log('\n| Model | Avg Latency | P95 Latency | Accuracy | Multi-Round Acc |');
    console.log('|-------|-------------|-------------|----------|-----------------|');
    for (const r of results) {
        const accStr = r.accuracy >= 0.95 ? '✅' : '⚠️';
        const multiStr = r.multiRoundAccuracy >= 0.9 ? '✅' : '⚠️';
        console.log(`| ${r.model} | ${r.avgLatency.toFixed(0)}ms | ${r.p95Latency.toFixed(0)}ms | ${(r.accuracy * 100).toFixed(1)}% ${accStr} | ${(r.multiRoundAccuracy * 100).toFixed(1)}% ${multiStr} |`);
    }

    // 选出最优模型
    console.log('\n🎯 SELECTION CRITERIA:');
    console.log('   - 闲聊延迟 ≤ 100ms + 多轮准确率 ≥ 90%');
    console.log('   - 任务延迟 ≤ 200ms + 意图准确率 ≥ 95%');

    const validModels = results.filter(r =>
        r.avgLatency > 0 &&
        r.accuracy >= 0.95 &&
        r.multiRoundAccuracy >= 0.9
    );

    if (validModels.length === 0) {
        console.error('\n❌ No model meets the accuracy threshold!');
        process.exit(1);
    }

    // 按延迟排序，选最快的
    const bestModel = validModels.sort((a, b) => a.avgLatency - b.avgLatency)[0];
    console.log(`\n✅ RECOMMENDED MODEL: ${bestModel.model}`);
    console.log(`   - Average latency: ${bestModel.avgLatency.toFixed(0)}ms`);
    console.log(`   - Accuracy: ${(bestModel.accuracy * 100).toFixed(1)}%`);
    console.log(`   - Multi-round accuracy: ${(bestModel.multiRoundAccuracy * 100).toFixed(1)}%`);

    // 延迟目标检查
    if (bestModel.avgLatency <= 100) {
        console.log('   - ✅ Meets 100ms target for chat scenarios');
    } else if (bestModel.avgLatency <= 200) {
        console.log('   - ✅ Meets 200ms target for task scenarios');
    } else {
        console.log('   - ⚠️ Does not meet latency target, consider further optimization');
    }

    process.exit(0);
}

main().catch(e => {
    console.error('FATAL ERROR:', e);
    process.exit(1);
});