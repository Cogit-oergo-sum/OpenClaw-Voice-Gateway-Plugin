import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

/**
 * 使用真实 Prompt 结构验证 IntentRouter 准确性
 * 模拟完整的路由场景，确保优化不影响准确率
 */

// === 真实的路由 Prompt 结构（模拟 prompts.ts + sle-payload-assembler.ts）===

function buildRealRouterPrompt(canvasState: { tasks: any[] } | null, skillsSummary: string = '[技能] delegate_openclaw'): string {
    // 模拟 INTENT_ROUTER_SYSTEM_PROMPT
    const basePrompt = `[System: Intent Router]
ONLY output raw JSON. NO markdown.

[Logic]
1. Context: If answer in [Active Canvas] -> "r":true. If in [Archive Memory] -> "m":true.
2. Ref: If referring to existing task -> "id":["task_id"].
3. Intents ("i"):
  - "t":"N" (NEW): Action on domain/data (e.g. create, delete file). Needs "f"(tool) and "q"(query <5 words).
  - "t":"C" (CANCEL): Stop AI's PENDING process. NOT for deleting files/data. Needs "tid"(target_task_id).
  - "t":"CL" (CLARIFY): ONLY if completely ambiguous.
  - If user is just chatting, stating status, or no action needed -> return empty array "i":[]

[Format Example]
{"i":[{"t":"N","n":"查询天气"}],"id":["t_1a2b"]}
*Strictly omit empty/false/null fields!`;

    // 模拟画布状态（当前格式）
    const canvasBlock = canvasState && canvasState.tasks.length > 0
        ? canvasState.tasks.map(t => `任务: ${t.name} (状态: ${t.status}, 内部ID: ${t.id}): ${t.summary?.slice(0, 50) || '无摘要'}...`).join('\n')
        : '(无活跃任务)';

    // 模拟归档索引（当前格式 - 这是要移除的部分）
    const archiveBlock = '(无)';  // 当前测试简化，不模拟归档

    // 组装完整 Prompt
    return `${basePrompt}\n\n${skillsSummary}\n\n【Active Canvas 活跃画布】\n${canvasBlock}\n\n【Archive Memory 最近归档记忆索引】\n${archiveBlock}`;
}

// === 测试用例 ===
const FULL_TEST_SUITE = [
    // 闲聊
    { id: 'CHAT-01', input: '你好', canvas: null, expected: { intents: [] } },
    { id: 'CHAT-02', input: '今天天气不错', canvas: null, expected: { intents: [] } },
    { id: 'CHAT-03', input: '有点累了', canvas: null, expected: { intents: [] } },
    { id: 'CHAT-04', input: '你在干嘛', canvas: null, expected: { intents: [] } },

    // 新任务
    { id: 'TASK-01', input: '帮我查一下天气', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },
    { id: 'TASK-02', input: '创建一个文档', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },
    { id: 'TASK-03', input: '帮我整理一下文件', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },
    { id: 'TASK-04', input: '删除那个文件', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },

    // 画布引用
    { id: 'REF-01', input: '刚才的任务怎么样', canvas: { tasks: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度' }] }, expected: { isAnswerInActiveCanvas: true } },
    { id: 'REF-02', input: '结果怎么样', canvas: { tasks: [{ id: 't_01', name: '文件整理', status: 'READY', summary: '已完成' }] }, expected: { isAnswerInActiveCanvas: true } },
    { id: 'REF-03', input: '之前的任务完成了吗', canvas: { tasks: [{ id: 't_01', name: '后台任务', status: 'COMPLETED', summary: '已完成' }] }, expected: { isAnswerInActiveCanvas: true } },

    // 取消任务
    { id: 'CANCEL-01', input: '取消刚才的任务', canvas: { tasks: [{ id: 't_01', name: '天气查询', status: 'PENDING', summary: '' }] }, expected: { intents: [{ type: 'CANCEL_TASK' }] } },
    { id: 'CANCEL-02', input: '取消它', canvas: { tasks: [{ id: 't_01', name: '文件创建', status: 'PENDING', summary: '' }] }, expected: { intents: [{ type: 'CANCEL_TASK' }] } },

    // 多轮指代
    { id: 'MULTI-01', input: '那个文件怎么样了', canvas: { tasks: [{ id: 't_01', name: '文件操作', status: 'READY', summary: '已创建test.md' }] }, expected: { isAnswerInActiveCanvas: true } },
    { id: 'MULTI-02', input: '继续', canvas: { tasks: [{ id: 't_01', name: '文档整理', status: 'PENDING', summary: '正在处理' }] }, expected: { intents: [] } },

    // 澄清
    { id: 'CLARIFY-01', input: '那个文档', canvas: null, expected: { intents: [{ type: 'CLARIFY' }] } },
];

// 比较函数
function compareResult(content: string, expected: Partial<{ intents: any[]; isAnswerInActiveCanvas: boolean }>): { match: boolean; reason?: string } {
    let result: any;
    try {
        result = JSON.parse(content);
    } catch {
        return { match: false, reason: `JSON 解析失败: ${content.slice(0, 50)}` };
    }

    const intents = result.i || result.intents || [];
    const isCanvasRef = result.r ?? result.isAnswerInCanvas ?? false;

    // 检查 intents
    if (expected.intents) {
        if (expected.intents.length === 0) {
            if (intents.length !== 0) {
                return { match: false, reason: `期望空意图，实际有 ${intents.length} 个: ${JSON.stringify(intents)}` };
            }
        } else {
            if (intents.length === 0) {
                return { match: false, reason: `期望有意图，实际为空` };
            }
            const expType = expected.intents[0].type;
            const actType = intents[0]?.t || intents[0]?.type;
            const typeMap: any = { 'N': 'NEW_TASK', 'C': 'CANCEL_TASK', 'CL': 'CLARIFY' };
            const actTypeNorm = typeMap[actType] || actType;
            if (expType !== actTypeNorm) {
                return { match: false, reason: `期望 ${expType}，实际 ${actTypeNorm}` };
            }
        }
    }

    // 检查 isAnswerInActiveCanvas
    if (expected.isAnswerInActiveCanvas !== undefined) {
        if (isCanvasRef !== expected.isAnswerInActiveCanvas) {
            return { match: false, reason: `期望 r=${expected.isAnswerInActiveCanvas}，实际 r=${isCanvasRef}` };
        }
    }

    return { match: true };
}

// 主测试
async function runFullAccuracyTest() {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';

    const openai = new OpenAI({ apiKey, baseURL: baseUrl });

    const model = 'qwen-turbo';

    console.log('🚀 IntentRouter Full Accuracy Test (Real Prompt Structure)');
    console.log('='.repeat(60));
    console.log(`Model: ${model}`);

    let passed = 0;
    let failed = 0;
    const latencies: number[] = [];
    const failures: string[] = [];

    for (const test of FULL_TEST_SUITE) {
        const systemPrompt = buildRealRouterPrompt(test.canvas);
        const start = Date.now();

        try {
            const params: any = {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: test.input }
                ],
                max_tokens: 100,
                temperature: 0,
                stream: true,
                response_format: { type: 'json_object' }
            };

            const stream = await openai.chat.completions.create(params as any) as any;
            let content = '';
            let ttft = 0;
            let firstChunk = true;

            for await (const chunk of stream) {
                if (firstChunk) {
                    ttft = Date.now() - start;
                    firstChunk = false;
                }
                content += chunk.choices?.[0]?.delta?.content || '';
            }

            const totalLatency = Date.now() - start;
            latencies.push(totalLatency);

            const comparison = compareResult(content, test.expected);

            if (comparison.match) {
                passed++;
                console.log(`✅ [${test.id}] "${test.input}" → TTFT=${ttft}ms, 总=${totalLatency}ms`);
            } else {
                failed++;
                failures.push(`[${test.id}] ${comparison.reason}`);
                console.log(`❌ [${test.id}] "${test.input}" → ${comparison.reason}`);
                console.log(`   输出: ${content}`);
            }
        } catch (e: any) {
            failed++;
            const latency = Date.now() - start;
            latencies.push(latency);
            console.log(`💥 [${test.id}] "${test.input}" → ${e.message.slice(0, 50)}`);
        }

        await new Promise(r => setTimeout(r, 300));
    }

    // 统计
    const accuracy = passed / FULL_TEST_SUITE.length;
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`Passed: ${passed}/${FULL_TEST_SUITE.length}`);
    console.log(`Accuracy: ${(accuracy * 100).toFixed(1)}%`);
    console.log(`Avg Latency: ${avgLatency.toFixed(0)}ms`);

    if (failed > 0) {
        console.log('\n❌ 失败详情:');
        for (const f of failures) {
            console.log(`  ${f}`);
        }
    }

    // 验证阈值
    if (accuracy < 0.95) {
        console.error(`\n❌ Accuracy ${(accuracy * 100).toFixed(1)}% below threshold 95%`);
        process.exit(1);
    }

    console.log('\n✅ Accuracy test passed!');
    process.exit(0);
}

runFullAccuracyTest().catch(e => {
    console.error('FATAL ERROR:', e);
    process.exit(1);
});