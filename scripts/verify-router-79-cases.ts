import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ROUTER_TEST_CASES, RouterTestCase } from './router-test-cases';

dotenv.config();

/**
 * IntentRouter 容错标准验证
 * - 可接受误判：闲聊/画布引用 → 任务（NEW_TASK/CANCEL_TASK/CLARIFY）
 * - 不可接受：任务 → 闲聊/画布引用（漏判）
 */

function buildImprovedRouterPrompt(canvasState: { tasks: any[] } | null): string {
    const basePrompt = `[Intent Router] 输出纯 JSON，严禁 markdown。

[意图类型]
- N (NEW_TASK): 创建/查询/删除/修改操作 → {"i":[{"t":"N","n":"任务名"}]}
- C (CANCEL): 取消正在进行的任务 → {"i":[{"t":"C","tid":"任务ID"}]}
- CL (CLARIFY): 完全不清楚用户意图 → {"i":[{"t":"CL","m":"澄清问题"}]}

[画布引用判断 ★关键]
当画布有任务时，用户询问任务的状态/结果/进度，返回 {"r":true} 而非新任务。
例如：
- "刚才的任务怎么样" → {"r":true}
- "结果怎么样" → {"r":true}
- "之前的任务完成了吗" → {"r":true}
- "那个XX怎么样了" → {"r":true}

[闲聊判断]
用户只是聊天/打招呼/表达状态，无需操作 → {"i":[]}
例如：
- "你好" → {"i":[]}
- "今天天气不错" → {"i":[]}
- "有点累" → {"i":[]}`;

    const canvasBlock = canvasState && canvasState.tasks && canvasState.tasks.length > 0
        ? `[当前画布任务]\n${canvasState.tasks.map(t => 
            `ID:${t.id} | 名称:${t.name} | 状态:${t.status} | 结果:${(t.summary || '').slice(0, 30) || '无'}`
          ).join('\n')}`
        : '[当前画布任务] (无)';
    return `${basePrompt}\n\n${canvasBlock}`;
}

// 容错比较函数
function compareResult(content: string, expected: any, testId: string): { match: boolean; reason?: string; isAcceptable?: boolean } {
    let result: any;
    try { result = JSON.parse(content); } catch { return { match: false, reason: 'JSON 解析失败' }; }

    const intents = result.i || [];
    const r = result.r ?? false;
    const category = testId.split('-')[0];
    const actualIntentType = intents[0]?.t;
    const map: any = { N: 'NEW_TASK', C: 'CANCEL_TASK', CL: 'CLARIFY' };
    const actualTypeNorm = map[actualIntentType] || actualIntentType;

    // === 核心判断逻辑 ===
    
    // 1. NEW_TASK/CANCEL_TASK 场景：必须返回对应意图（不能漏判）
    if (expected.intents?.[0]?.type === 'NEW_TASK') {
        if (intents.length === 0) {
            return { match: false, reason: '❌漏判: NEW_TASK被判为空意图' };
        }
        if (r === true) {
            return { match: false, reason: '❌漏判: NEW_TASK被判为画布引用' };
        }
        if (actualTypeNorm === 'NEW_TASK') {
            return { match: true };  // 正确
        }
        // CANCEL_TASK/CLARIFY 对 NEW_TASK 请求也算可接受（不会漏判）
        return { match: false, reason: `期望NEW_TASK，实际${actualTypeNorm}`, isAcceptable: true };
    }

    if (expected.intents?.[0]?.type === 'CANCEL_TASK') {
        if (intents.length === 0) {
            return { match: false, reason: '❌漏判: CANCEL_TASK被判为空意图' };
        }
        if (r === true) {
            return { match: false, reason: '❌漏判: CANCEL_TASK被判为画布引用' };
        }
        if (actualTypeNorm === 'CANCEL_TASK') {
            return { match: true };
        }
        return { match: false, reason: `期望CANCEL_TASK，实际${actualTypeNorm}`, isAcceptable: true };
    }

    // 2. 闲聊场景（CHAT）：空意图正确，但返回任务也算可接受
    if (category === 'CHAT' && expected.intents?.length === 0) {
        if (intents.length === 0) {
            return { match: true };  // 正确
        }
        // 返回 NEW_TASK/CANCEL_TASK/CLARIFY 是可接受的误判
        return { match: false, reason: `闲聊被判为${actualTypeNorm}（可接受误判）`, isAcceptable: true };
    }

    // 3. 画布引用场景（REF）：r=true 正确，但返回 NEW_TASK 也算可接受
    if (category === 'REF' && expected.isAnswerInActiveCanvas === true) {
        if (r === true) {
            return { match: true };  // 正确
        }
        if (actualTypeNorm === 'NEW_TASK') {
            // 画布引用被判为 NEW_TASK 是可接受的误判（SLE兜底）
            return { match: false, reason: '画布引用被判为NEW_TASK（可接受误判）', isAcceptable: true };
        }
        if (actualTypeNorm === 'CANCEL_TASK') {
            return { match: false, reason: '画布引用被判为CANCEL_TASK（可接受误判）', isAcceptable: true };
        }
        if (intents.length === 0) {
            return { match: false, reason: '画布引用被判为空意图（可接受误判）', isAcceptable: true };
        }
        return { match: false, reason: `画布引用被判为${actualTypeNorm}` };
    }

    // 4. 其他场景默认严格匹配
    if (expected.intents?.length === 0 && intents.length !== 0) {
        return { match: false, reason: `期望空，实际${JSON.stringify(intents)}` };
    }
    if (expected.isAnswerInActiveCanvas !== undefined && r !== expected.isAnswerInActiveCanvas) {
        return { match: false, reason: `期望 r=${expected.isAnswerInActiveCanvas}，实际 r=${r}` };
    }
    
    return { match: true };
}

async function runTest() {
    const openai = new OpenAI({ apiKey: process.env.BAILIAN_API_KEY, baseURL: process.env.BAILIAN_BASE_URL });
    const model = 'qwen-turbo';

    console.log('🚀 IntentRouter Validation (Tolerant Standard)');
    console.log('='.repeat(60));
    console.log(`Model: ${model}`);
    console.log(`Total cases: ${ROUTER_TEST_CASES.length}`);
    console.log('容错标准: 可接受闲聊→任务误判，不可接受任务→闲聊漏判');

    let strictPassed = 0;  // 严格匹配
    let acceptablePassed = 0;  // 容错通过（含可接受误判）
    let criticalFailed = 0;  // 关键失败（漏判）
    const latencies: number[] = [];
    const failures: { id: string; reason: string; acceptable: boolean }[] = [];
    const categoryStats: Record<string, { strict: number; acceptable: number; critical: number; total: number }> = {};

    for (const test of ROUTER_TEST_CASES) {
        const prompt = buildImprovedRouterPrompt(test.canvas as any);
        const start = Date.now();

        try {
            const params: any = {
                model,
                messages: [
                    { role: 'system', content: prompt },
                    ...test.history.map(h => ({ role: 'user', content: h })),
                    { role: 'user', content: test.input }
                ],
                max_tokens: 50,
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

            const latency = Date.now() - start;
            latencies.push(latency);

            const cmp = compareResult(content, test.expected, test.id);
            const cat = test.id.split('-')[0];
            if (!categoryStats[cat]) categoryStats[cat] = { strict: 0, acceptable: 0, critical: 0, total: 0 };
            categoryStats[cat].total++;

            if (cmp.match) {
                strictPassed++;
                acceptablePassed++;
                categoryStats[cat].strict++;
                categoryStats[cat].acceptable++;
                console.log(`✅ [${test.id}] "${test.input.slice(0, 15)}..." → TTFT=${ttft}ms`);
            } else if (cmp.isAcceptable) {
                acceptablePassed++;
                categoryStats[cat].acceptable++;
                console.log(`⚠️ [${test.id}] "${test.input.slice(0, 15)}..." → ${cmp.reason}`);
            } else {
                criticalFailed++;
                categoryStats[cat].critical++;
                failures.push({ id: test.id, reason: cmp.reason || '', acceptable: false });
                console.log(`❌ [${test.id}] "${test.input.slice(0, 15)}..." → ${cmp.reason}`);
            }
        } catch (e: any) {
            const latency = Date.now() - start;
            latencies.push(latency);
            const cat = test.id.split('-')[0];
            if (!categoryStats[cat]) categoryStats[cat] = { strict: 0, acceptable: 0, critical: 0, total: 0 };
            categoryStats[cat].total++;
            categoryStats[cat].critical++;
            criticalFailed++;
            console.log(`💥 [${test.id}] "${test.input.slice(0, 15)}..." → ${e.message.slice(0, 50)}`);
        }

        await new Promise(r => setTimeout(r, 150));
    }

    const strictAccuracy = strictPassed / ROUTER_TEST_CASES.length;
    const acceptableAccuracy = acceptablePassed / ROUTER_TEST_CASES.length;
    const avgLatency = latencies.reduce((a, b) => a + b, 0) / latencies.length;

    console.log('\n' + '='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log(`严格匹配: ${strictPassed}/${ROUTER_TEST_CASES.length} (${(strictAccuracy * 100).toFixed(1)}%)`);
    console.log(`容错通过: ${acceptablePassed}/${ROUTER_TEST_CASES.length} (${(acceptableAccuracy * 100).toFixed(1)}%)`);
    console.log(`关键失败(漏判): ${criticalFailed}/${ROUTER_TEST_CASES.length}`);
    console.log(`平均TTFT: ${avgLatency.toFixed(0)}ms`);

    console.log('\n分类统计:');
    for (const [cat, data] of Object.entries(categoryStats)) {
        const acc = data.acceptable / data.total * 100;
        const critRate = data.critical / data.total * 100;
        const status = critRate === 0 ? '✅' : (critRate < 10 ? '⚠️' : '❌');
        console.log(`  ${cat}: 严格=${data.strict}/${data.total}, 容错=${data.acceptable}/${data.total}, 漏判=${data.critical} ${status}`);
    }

    if (criticalFailed > 0) {
        console.log('\n❌ 关键失败详情(漏判):');
        for (const f of failures.filter(f => !f.acceptable)) {
            console.log(`  ${f.id}: ${f.reason}`);
        }
    }

    // 关键标准：漏判率必须为 0
    if (criticalFailed > 0) {
        console.error(`\n❌ 存在 ${criticalFailed} 个关键漏判，测试失败！`);
        process.exit(1);
    }

    console.log('\n✅ 无关键漏判，测试通过！');
    process.exit(0);
}

runTest().catch(e => {
    console.error('FATAL ERROR:', e);
    process.exit(1);
});
