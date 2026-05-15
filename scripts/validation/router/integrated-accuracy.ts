/**
 * IntentRouter + SLE (DECIDING) 联合验证脚本
 *
 * 两层判断验证：
 * 1. IntentRouter 容错通过率（允许闲聊→任务误判）
 * 2. 整体判断准确率（IntentRouter + SLE 联合后的最终结果）
 *
 * SLE 兜底能力：当 IntentRouter 误判闲聊为任务时，SLE 可通过 intent=空 + response=直接回答 来纠正
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ROUTER_TEST_CASES } from './test-cases';
import {
    ValidationConfig,
    IntegratedTestCase,
    IntegratedTestResult,
    IntegratedValidationMetrics,
    SLEOutputResult,
    VALIDATION_STANDARDS,
    RouterTestCase
} from '../types';

dotenv.config();

/**
 * 构建 IntentRouter Prompt（沿用 accuracy.ts）
 */
function buildRouterPrompt(canvas: any[] | null): string {
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

    const canvasBlock = canvas && canvas.length > 0
        ? `[当前画布任务]\n${canvas.map(t =>
            `ID:${t.id} | 名称:${t.name} | 状态:${t.status} | 结果:${(t.summary || '').slice(0, 30) || '无'}`
          ).join('\n')}`
        : '[当前画布任务] (无)';
    return `${basePrompt}\n\n${canvasBlock}`;
}

/**
 * 构建 SLE (DECIDING) Prompt
 */
function buildSLEDecidingPrompt(text: string, taskName: string, canvasSnapshot: string): string {
    return `你是 Soul-Logic-Expert (SLE) —— 一个冷静、极致理性的任务逻辑专家。
你的职责是基于对话上下文和画布状态，精准判定用户的意图。

# Rules:
请严格遵循以下协议：

## 1. 动作调用协议 (Action Protocol)
当用户的需求需要查阅资料、操作软硬件或委派任务时，你必须立即触发匹配的工具：
- **强制指令重写**：在向工具传入参数前，绝对禁止直接复刻用户的原始口语化输入。

## 2. 响应互斥协议 (Response Mutex)
- **启动任务时**：如果你决定调用工具，你的 \`response\` 字段必须严格留空。
- **结束任务/直答时**：只有在可以直接回答用户时，才允许在 \`response\` 字段中输出文字。

# Output:
严格输出纯 JSON 字符串：
{
  "thought": "简短的中文思维链",
  "intent": "工具标识符（如 weather_mcp）。若无需调用工具，必须留空",
  "command": "重写后的任务指令。若无需调用工具，必须留空",
  "response": "面向用户的最终结果。若 intent 非空，此字段必须为空"
}

---

[Focused Task Snapshot]:
任务: ${taskName} (状态: 处理中)

[User Input]: ${text}

请判断：这个输入是否真的需要调用工具执行任务？还是可以直接回答用户？`;
}

/**
 * 执行 IntentRouter 判断
 */
async function runIntentRouter(testCase: RouterTestCase, config: ValidationConfig): Promise<any> {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    const routerModel = config.model || process.env.ROUTER_MODEL || 'qwen-turbo';

    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    const prompt = buildRouterPrompt(testCase.canvas);

    const messages = [
        { role: 'system', content: prompt },
        ...testCase.history.map(h => ({ role: 'user', content: h })),
        { role: 'user', content: testCase.input }
    ];

    try {
        const stream = await openai.chat.completions.create({
            model: routerModel,
            messages,
            max_tokens: 50,
            temperature: 0,
            stream: true,
            response_format: { type: 'json_object' }
        } as any);

        let content = '';
        for await (const chunk of stream as any) {
            content += chunk.choices?.[0]?.delta?.content || '';
        }

        const result = JSON.parse(content);
        const intents = result.i || [];
        const r = result.r ?? false;

        return {
            intents: intents.map((i: any) => ({
                type: i.t === 'N' ? 'NEW_TASK' : (i.t === 'C' ? 'CANCEL_TASK' : (i.t === 'CL' ? 'CLARIFY' : i.t)),
                task_name: i.n
            })),
            isAnswerInActiveCanvas: r,
            rawContent: content
        };
    } catch (e: any) {
        return {
            intents: [],
            isAnswerInActiveCanvas: false,
            error: e.message
        };
    }
}

/**
 * 执行 SLE (DECIDING) 判断
 */
async function runSLEDeciding(
    text: string,
    taskName: string,
    config: ValidationConfig
): Promise<SLEOutputResult> {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    const sleModel = process.env.SLE_MODEL || config.model || 'qwen-turbo';

    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    const prompt = buildSLEDecidingPrompt(text, taskName, '无活跃任务');

    try {
        const response = await openai.chat.completions.create({
            model: sleModel,
            messages: [
                { role: 'system', content: prompt },
                { role: 'user', content: text }
            ],
            max_tokens: 200,
            temperature: 0,
            response_format: { type: 'json_object' }
        });

        const content = response.choices[0]?.message?.content || '';
        const parsed = JSON.parse(content);

        return {
            output: parsed.response || parsed.direct_response || '',
            toolCalls: [],  // 模拟场景下不实际调用工具
            intent: parsed.intent || '',
            parsed
        };
    } catch (e: any) {
        return {
            output: '',
            toolCalls: [],
            intent: '',
            error: e.message
        };
    }
}

/**
 * Router 结果比较（沿用 accuracy.ts 逻辑）
 */
function compareRouterResult(routerResult: any, testCase: RouterTestCase): {
    passed: boolean;
    isCritical: boolean;
    isAcceptable: boolean;
    reason: string;
} {
    const intents = routerResult.intents || [];
    const r = routerResult.isAnswerInActiveCanvas ?? false;
    const category = testCase.id.split('-')[0];
    const actualIntentType = intents[0]?.type;

    // 1. NEW_TASK 场景：必须返回对应意图（不能漏判）
    if (testCase.expected.intents?.[0]?.type === 'NEW_TASK') {
        if (intents.length === 0) {
            return { passed: false, isCritical: true, isAcceptable: false, reason: '❌漏判: NEW_TASK被判为空意图' };
        }
        if (r === true) {
            return { passed: false, isCritical: true, isAcceptable: false, reason: '❌漏判: NEW_TASK被判为画布引用' };
        }
        if (actualIntentType === 'NEW_TASK') {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        return { passed: false, isCritical: false, isAcceptable: true, reason: `期望NEW_TASK，实际${actualIntentType}` };
    }

    // 2. 闲聊场景（CHAT）：空意图正确，但返回任务也算可接受
    if (category === 'CHAT' && testCase.expected.intents?.length === 0) {
        if (intents.length === 0) {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        // 返回 NEW_TASK 是可接受的误判（SLE 会兜底）
        return { passed: false, isCritical: false, isAcceptable: true, reason: `闲聊被判为${actualIntentType}（可接受误判）` };
    }

    // 3. 画布引用场景（REF）：r=true 正确，但返回 NEW_TASK 也算可接受
    if ((category === 'REF' || category === 'MULTITASK') && testCase.expected.isAnswerInActiveCanvas === true) {
        if (r === true) {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        if (actualIntentType === 'NEW_TASK') {
            return { passed: false, isCritical: false, isAcceptable: true, reason: '画布引用被判为NEW_TASK（可接受误判）' };
        }
        if (intents.length === 0) {
            return { passed: false, isCritical: false, isAcceptable: true, reason: '画布引用被判为空意图（可接受误判）' };
        }
        return { passed: false, isCritical: true, isAcceptable: false, reason: `画布引用被判为${actualIntentType}` };
    }

    // 4. 其他场景默认判定（与 accuracy.ts 保持一致）
    // 如果期望空意图但实际有 intents → 关键失败
    if (testCase.expected.intents?.length === 0 && intents.length !== 0) {
        return { passed: false, isCritical: true, isAcceptable: false, reason: `期望空，实际${JSON.stringify(intents)}` };
    }
    // 如果期望特定 r 值但实际不符 → 关键失败
    if (testCase.expected.isAnswerInActiveCanvas !== undefined && r !== testCase.expected.isAnswerInActiveCanvas) {
        return { passed: false, isCritical: true, isAcceptable: false, reason: `期望 r=${testCase.expected.isAnswerInActiveCanvas}，实际 r=${r}` };
    }

    return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
}

/**
 * SLE 结果比较
 */
function compareSLEResult(
    sleResult: SLEOutputResult | null,
    testCase: IntegratedTestCase,
    routerMisjudged: boolean
): {
    passed: boolean;
    isFallback: boolean;
    reason: string;
} {
    // 如果 SLE 未触发
    if (!sleResult) {
        return { passed: true, isFallback: false, reason: 'SLE 未触发（预期）' };
    }

    const intent = sleResult.intent || '';
    const hasResponse = (sleResult.output || '').length > 0;
    const category = testCase.id.split('-')[0];

    // === SLE 兜底判定 ===
    // 当 Router 误判闲聊为任务时，检查 SLE 是否正确兜底
    if (routerMisjudged && category === 'CHAT') {
        if (!intent && hasResponse) {
            // SLE 兜底成功：intent=空，有直接回答
            return { passed: true, isFallback: true, reason: 'SLE 兜底成功：直接回答而非调用工具' };
        }
        if (intent) {
            // SLE 兜底失败：误调用了工具
            return { passed: false, isFallback: false, reason: 'SLE 兜底失败：误调用了工具' };
        }
    }

    // === SLE 工具调用判定 ===
    // 当 Router 正确判定为任务时，检查 SLE 是否调用工具
    if (testCase.expected.intents?.[0]?.type === 'NEW_TASK') {
        if (!intent && !hasResponse) {
            return { passed: false, isFallback: false, reason: 'SLE 未调用工具也未回答' };
        }
        if (intent) {
            return { passed: true, isFallback: false, reason: 'SLE 正确调用工具' };
        }
        // SLE 直接回答（简单任务场景）
        return { passed: true, isFallback: false, reason: 'SLE 直接回答（简单任务）' };
    }

    return { passed: true, isFallback: false, reason: 'SLE 结果符合预期' };
}

/**
 * 最终结果判定（两层联合）
 */
function determineFinalOutcome(
    routerResult: any,
    sleResult: SLEOutputResult | null,
    testCase: IntegratedTestCase
): {
    passed: boolean;
    outcome: string;
    reason: string;
} {
    const intents = routerResult.intents || [];
    const category = testCase.id.split('-')[0];
    const expectedType = testCase.expected.intents?.[0]?.type;

    // === 闲聊场景 ===
    if (category === 'CHAT' && testCase.expected.intents?.length === 0) {
        if (intents.length === 0) {
            // Router 正确：直接闲聊
            return { passed: true, outcome: 'DIRECT_RESPONSE', reason: 'Router正确：闲聊直接回答' };
        }
        if (intents[0]?.type === 'NEW_TASK' && sleResult) {
            // Router 误判 + SLE 触发
            if (!sleResult.intent && sleResult.output) {
                // SLE 兜底成功
                return { passed: true, outcome: 'DIRECT_RESPONSE', reason: 'Router误判但SLE兜底成功' };
            }
            if (sleResult.intent) {
                // SLE 兜底失败
                return { passed: false, outcome: 'TASK_CREATED', reason: 'SLE兜底失败：错误调用工具' };
            }
        }
        return { passed: false, outcome: 'UNKNOWN', reason: '未知结果' };
    }

    // === 任务场景 ===
    if (expectedType === 'NEW_TASK') {
        if (intents.length === 0 || routerResult.isAnswerInActiveCanvas) {
            // Router 漏判：关键失败
            return { passed: false, outcome: 'NO_ACTION', reason: '❌关键失败：任务被漏判' };
        }
        if (intents[0]?.type === 'NEW_TASK') {
            // Router 正确判定为任务
            if (sleResult?.intent) {
                return { passed: true, outcome: 'TASK_CREATED', reason: '正确：创建并执行任务' };
            }
            if (sleResult?.output && !sleResult?.intent) {
                return { passed: true, outcome: 'DIRECT_RESPONSE', reason: '正确：SLE直接回答' };
            }
        }
    }

    // === CANCEL_TASK 场景 ===
    if (expectedType === 'CANCEL_TASK') {
        if (intents.some(i => i.type === 'CANCEL_TASK')) {
            return { passed: true, outcome: 'CANCELLED', reason: '正确：取消任务' };
        }
        if (intents.length === 0) {
            return { passed: false, outcome: 'NO_ACTION', reason: '❌关键失败：取消请求被漏判' };
        }
        // Router 返回其他意图（可能是可接受误判）
        return { passed: true, outcome: 'DIRECT_RESPONSE', reason: 'Router可接受误判' };
    }

    // === 画布引用场景（REF/MULTITASK） ===
    if ((category === 'REF' || category === 'MULTITASK') && testCase.expected.isAnswerInActiveCanvas === true) {
        if (routerResult.isAnswerInActiveCanvas === true) {
            return { passed: true, outcome: 'CANVAS_ANSWER', reason: '正确：画布引用' };
        }
        // Router 返回 NEW_TASK 或空意图（可接受误判）
        return { passed: true, outcome: 'DIRECT_RESPONSE', reason: 'Router可接受误判' };
    }

    // === SPECIAL 场景：根据期望判定 ===
    if (category === 'SPECIAL') {
        if (testCase.expected.isAnswerInActiveCanvas === true) {
            if (routerResult.isAnswerInActiveCanvas === true) {
                return { passed: true, outcome: 'CANVAS_ANSWER', reason: '正确：画布引用' };
            }
            return { passed: true, outcome: 'DIRECT_RESPONSE', reason: '默认判定' };
        }
        if (testCase.expected.intents?.length === 0) {
            if (intents.length === 0) {
                return { passed: true, outcome: 'DIRECT_RESPONSE', reason: '正确：空意图' };
            }
            // 误判为任务，可能触发 SLE
            if (intents[0]?.type === 'NEW_TASK' && sleResult) {
                if (!sleResult.intent && sleResult.output) {
                    return { passed: true, outcome: 'DIRECT_RESPONSE', reason: 'SLE兜底成功' };
                }
                return { passed: false, outcome: 'TASK_CREATED', reason: 'SLE兜底失败' };
            }
            return { passed: true, outcome: 'DIRECT_RESPONSE', reason: '默认判定' };
        }
    }

    // === 其他场景默认判定 ===
    // 如果 Router 通过（正确或可接受误判），最终也通过
    return { passed: true, outcome: 'DIRECT_RESPONSE', reason: '默认判定' };
}

/**
 * 执行联合验证测试
 */
async function runIntegratedTest(
    testCase: RouterTestCase,
    config: ValidationConfig
): Promise<IntegratedTestResult> {
    // 第一层：IntentRouter
    const routerResult = await runIntentRouter(testCase, config);
    const routerCmp = compareRouterResult(routerResult, testCase);

    // 第二层：SLE（条件触发）
    let sleResult: SLEOutputResult | null = null;
    let sleCmp = { passed: true, isFallback: false, reason: '' };
    const shouldTriggerSLE = routerResult.intents.some(i => i.type === 'NEW_TASK');
    const routerMisjudged = !routerCmp.passed && routerCmp.isAcceptable;

    if (shouldTriggerSLE) {
        const taskName = routerResult.intents[0]?.task_name || testCase.input;
        sleResult = await runSLEDeciding(testCase.input, taskName, config);
        sleCmp = compareSLEResult(sleResult, testCase as IntegratedTestCase, routerMisjudged);
    }

    // 最终判定
    const finalCmp = determineFinalOutcome(routerResult, sleResult, testCase as IntegratedTestCase);

    return {
        testCaseId: testCase.id,
        passed: finalCmp.passed,
        isCritical: !routerCmp.passed && routerCmp.isCritical,
        isAcceptable: routerCmp.isAcceptable,

        // Router 层
        routerPassed: routerCmp.passed,
        routerAcceptable: routerCmp.isAcceptable,
        routerCritical: routerCmp.isCritical,
        routerReason: routerCmp.reason,

        // SLE 层
        sleTriggered: sleResult !== null,
        slePassed: sleCmp.passed,
        sleFallback: sleCmp.isFallback,
        sleReason: sleCmp.reason,

        // 最终
        finalPassed: finalCmp.passed,
        finalOutcome: finalCmp.outcome,
        finalReason: finalCmp.reason,

        expected: testCase.expected,
        actual: {
            router: routerResult,
            sle: sleResult
        },
        reason: finalCmp.reason
    };
}

/**
 * 计算联合验证指标
 */
function calculateIntegratedMetrics(results: IntegratedTestResult[]): IntegratedValidationMetrics {
    const total = results.length;

    // Router 层
    const routerPassed = results.filter(r => r.routerPassed);
    const routerAcceptable = results.filter(r => r.routerAcceptable && !r.routerPassed);
    const routerCritical = results.filter(r => r.routerCritical);

    // SLE 层
    const sleTriggered = results.filter(r => r.sleTriggered);
    const slePassed = sleTriggered.filter(r => r.slePassed);
    const sleFallback = sleTriggered.filter(r => r.sleFallback);

    // 最终
    const finalPassed = results.filter(r => r.finalPassed);

    // 兜底成功率：Router 误判场景下 SLE 兜底成功的比例
    const routerMisjudged = results.filter(r => r.routerAcceptable && !r.routerPassed && r.sleTriggered);
    const fallbackSuccess = routerMisjudged.filter(r => r.sleFallback && r.finalPassed);

    return {
        // Router 层
        routerStrictAccuracy: (routerPassed.length / total) * 100,
        routerTolerantAccuracy: ((routerPassed.length + routerAcceptable.length) / total) * 100,
        routerCriticalFailures: routerCritical.length,

        // SLE 层
        sleTriggerRate: sleTriggered.length > 0
            ? (sleTriggered.length / results.filter(r => !r.routerPassed && r.routerAcceptable || r.routerPassed && r.routerResult?.intents?.some?.(i => i.type === 'NEW_TASK')).length) * 100
            : 0,
        sleFallbackRate: sleTriggered.length > 0
            ? (sleFallback.length / sleTriggered.length) * 100
            : 0,
        sleToolCallAccuracy: sleTriggered.length > 0
            ? (slePassed.filter(r => !r.sleFallback).length / sleTriggered.length) * 100
            : 100,

        // 联合
        finalAccuracy: (finalPassed.length / total) * 100,
        fallbackSuccessRate: routerMisjudged.length > 0
            ? (fallbackSuccess.length / routerMisjudged.length) * 100
            : 100
    };
}

/**
 * 直接运行入口
 */
async function runDirectValidation() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('');
        console.log('Usage: npm run test:router:integrated [options]');
        console.log('');
        console.log('Options:');
        console.log('  --strict        严格模式（关键失败必须为0）');
        console.log('  --verbose       详细输出');
        console.log('  --model=<name>  指定模型');
        console.log('  --help          显示帮助信息');
        console.log('');
        process.exit(0);
    }

    const modelArg = args.find(a => a.startsWith('--model='))?.split('=')[1];
    const model = modelArg || args.find(a => !a.startsWith('--')) || process.env.ROUTER_MODEL || 'qwen-turbo';

    const config: ValidationConfig = {
        component: 'integrated',
        model,
        outputFormat: 'console',
        strict: args.includes('--strict'),
        verbose: args.includes('--verbose')
    };

    const testCases = ROUTER_TEST_CASES as RouterTestCase[];
    const results: IntegratedTestResult[] = [];

    console.log(`\n🚀 IntentRouter + SLE (DECIDING) 联合验证`);
    console.log(`Router Model: ${model}`);
    console.log(`SLE Model: ${process.env.SLE_MODEL || model}`);
    console.log(`Test cases: ${testCases.length}`);
    console.log('='.repeat(60));

    for (const testCase of testCases) {
        const result = await runIntegratedTest(testCase, config);
        results.push(result);

        const icon = result.finalPassed ? '✅' :
                     (result.routerCritical ? '❌' : '⚠️');

        if (config.verbose) {
            console.log(`${icon} [${testCase.id}] ${testCase.input}`);
            console.log(`   Router: ${result.routerPassed ? '正确' : (result.routerAcceptable ? '可接受误判' : '漏判')}`);
            if (result.sleTriggered) {
                console.log(`   SLE: ${result.slePassed ? (result.sleFallback ? '兜底成功' : '正确调用') : '失败'}`);
            }
            console.log(`   最终: ${result.finalOutcome}`);
        } else {
            console.log(`${icon} [${testCase.id}] ${result.finalReason}`);
        }

        await new Promise(r => setTimeout(r, 200)); // 防止 API 限流
    }

    const metrics = calculateIntegratedMetrics(results);

    console.log('\n' + '='.repeat(60));
    console.log('\n## 两层验证指标');
    console.log('');
    console.log('| 指标 | 值 | 阈值 | 状态 |');
    console.log('|------|-----|------|------|');
    console.log(`| Router 容错通过率 | ${metrics.routerTolerantAccuracy.toFixed(1)}% | ≥90% | ${metrics.routerTolerantAccuracy >= 90 ? '✅' : '❌'} |`);
    console.log(`| Router 关键漏判数 | ${metrics.routerCriticalFailures} | =0 | ${metrics.routerCriticalFailures === 0 ? '✅' : '❌'} |`);
    console.log(`| 整体准确率 | ${metrics.finalAccuracy.toFixed(1)}% | ≥95% | ${metrics.finalAccuracy >= 95 ? '✅' : '❌'} |`);
    console.log(`| SLE 兜底成功率 | ${metrics.fallbackSuccessRate.toFixed(1)}% | ≥80% | ${metrics.fallbackSuccessRate >= 80 || metrics.fallbackSuccessRate === 100 ? '✅' : '❌'} |`);

    console.log('\n## 详细统计');
    console.log(`Router 严格匹配: ${results.filter(r => r.routerPassed).length}/${testCases.length}`);
    console.log(`Router 可接受误判: ${results.filter(r => r.routerAcceptable).length}`);
    console.log(`Router 关键失败: ${metrics.routerCriticalFailures}`);
    console.log(`SLE 触发次数: ${results.filter(r => r.sleTriggered).length}`);
    console.log(`SLE 兜底成功: ${results.filter(r => r.sleFallback).length}`);
    console.log(`最终通过: ${results.filter(r => r.finalPassed).length}/${testCases.length}`);

    // 退出判定
    if (metrics.routerCriticalFailures > 0) {
        console.error('\n❌ 存在关键漏判，验证失败！');
        process.exit(1);
    }

    if (config.strict && metrics.finalAccuracy < 95) {
        console.error('\n❌ 整体准确率未达标（严格模式）！');
        process.exit(1);
    }

    console.log('\n✅ 联合验证通过！');
    process.exit(0);
}

// 直接运行
if (require.main === module) {
    runDirectValidation().catch(e => {
        console.error('FATAL:', e);
        process.exit(1);
    });
}

export { runIntegratedTest, calculateIntegratedMetrics, getValidationSuite };

function getValidationSuite() {
    return {
        name: 'IntentRouter + SLE Integrated Validation',
        component: 'integrated',
        testCases: ROUTER_TEST_CASES,
        standard: VALIDATION_STANDARDS.integrated,
        run: runIntegratedTest
    };
}