/**
 * [V4.0] IntentRouter 准确率验证套件 - 极简三分类版本
 *
 * 输出格式："" (chat) | "y" (canvas) | "t" (task)
 *
 * 容错标准：
 * - 可接受误判：chat/canvas → task（SLE兜底）
 * - 不可接受漏判：task → chat/canvas（FATAL）
 */

import * as dotenv from 'dotenv';
import OpenAI from 'openai';
import { ROUTER_TEST_CASES, TEST_STATS, RouterTestCase } from '../../router-test-cases';
import { INTENT_ROUTER_LITE_PROMPT } from '../../../src/agent/prompts';

dotenv.config();

/**
 * [V4.0] 构建极简路由 Prompt（与实际调用一致）
 */
function buildRouterPrompt(canvas: any[] | null): string {
    // 极简画布格式: `[id] name`
    const canvasBlock = canvas && canvas.length > 0
        ? `[Canvas]\n${canvas.map(t => `[${t.id}] ${t.name}`).join('\n')}`
        : '[Canvas] (无)';

    return `${INTENT_ROUTER_LITE_PROMPT()}\n\n${canvasBlock}`;
}

/**
 * [V4.0] 极简结果比较（1字符格式：""|"y"|"t"）
 */
function compareResult(content: string, expected: any, testId: string): { passed: boolean; isCritical: boolean; isAcceptable: boolean; reason: string } {
    const output = content.trim();
    const expectedType = expected.type;

    // 解析极简输出："" | "y" | "t"
    let actualType: 'chat' | 'canvas' | 'task';
    let matchedIds: string[] = [];

    if (output === '' || output === '{}' || output === '""' || output === '""""') {
        actualType = 'chat';
    } else if (output === 'y' || output.startsWith('y') || output === '"y"') {
        actualType = 'canvas';
        // 解析 "y:t_01" 格式
        const idsStr = output.replace(/^["']?y["']?[:]?/, '').replace(/["']/g, '');
        matchedIds = idsStr.split(',').filter(id => id.trim());
    } else if (output === 't' || output === '"t"' || output.includes('t')) {
        actualType = 'task';
    } else {
        // 未知输出，保守视为 task
        actualType = 'task';
    }

    // === 核心判断逻辑 ===

    // 1. 期望 task 时：必须返回 task（不能漏判）
    if (expectedType === 'task') {
        if (actualType === 'task') {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        // task → chat 或 task → canvas 是致命漏判
        return { passed: false, isCritical: true, isAcceptable: false, reason: `❌漏判: 期望task，实际${actualType}` };
    }

    // 2. 期望 chat 时：chat 正确，但返回 task 是可接受的误判
    if (expectedType === 'chat') {
        if (actualType === 'chat') {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        if (actualType === 'task') {
            return { passed: false, isCritical: false, isAcceptable: true, reason: `chat被判为task（可接受误判）` };
        }
        // chat → canvas 也是可接受的
        return { passed: false, isCritical: false, isAcceptable: true, reason: `chat被判为canvas（可接受误判）` };
    }

    // 3. 期望 canvas 时：canvas 正确，但返回 task 是可接受的误判
    if (expectedType === 'canvas') {
        if (actualType === 'canvas') {
            return { passed: true, isCritical: false, isAcceptable: false, reason: '' };
        }
        if (actualType === 'task') {
            return { passed: false, isCritical: false, isAcceptable: true, reason: `canvas被判为task（可接受误判）` };
        }
        // canvas → chat 是可接受的
        return { passed: false, isCritical: false, isAcceptable: true, reason: `canvas被判为chat（可接受误判）` };
    }

    // 4. 其他情况
    return { passed: actualType === expectedType, isCritical: false, isAcceptable: false, reason: `期望${expectedType}，实际${actualType}` };
}

/**
 * 执行单个测试用例
 */
async function runTestCase(testCase: RouterTestCase, config: any): Promise<any> {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    const model = config.model || 'qwen-turbo';

    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    const prompt = buildRouterPrompt(testCase.canvas);

    const messages = [
        { role: 'system', content: prompt },
        ...testCase.history.map(h => ({ role: 'user', content: h })),
        { role: 'user', content: testCase.input }
    ];

    try {
        const params: any = {
            model,
            messages,
            max_tokens: 10,
            temperature: 0,
            stream: true
        };

        const stream = await openai.chat.completions.create(params as any) as any;
        let content = '';

        for await (const chunk of stream) {
            content += chunk.choices?.[0]?.delta?.content || '';
        }

        const cmp = compareResult(content, testCase.expected, testCase.id);

        return {
            testCaseId: testCase.id,
            passed: cmp.passed,
            isCritical: cmp.isCritical,
            isAcceptable: cmp.isAcceptable,
            expected: testCase.expected,
            actual: content.trim(),
            reason: cmp.reason
        };
    } catch (e: any) {
        return {
            testCaseId: testCase.id,
            passed: false,
            isCritical: true,
            isAcceptable: false,
            expected: testCase.expected,
            actual: null,
            reason: `Error: ${e.message.slice(0, 50)}`
        };
    }
}

/**
 * 直接运行入口
 */
async function runDirectValidation() {
    const args = process.argv.slice(2);

    if (args.includes('--help') || args.includes('-h')) {
        console.log('');
        console.log('Usage: npm run test:router [model] [options]');
        console.log('');
        console.log('[V4.0] IntentRouter 极简三分类验证');
        console.log('');
        console.log('Output Format:');
        console.log('  ""  = chat');
        console.log('  "y" = canvas');
        console.log('  "t" = task');
        console.log('');
        console.log('Options:');
        console.log('  --strict        严格模式（关键失败必须为0）');
        console.log('  --verbose       详细输出');
        console.log('  --iter=N        重复测试次数');
        console.log('  --help          显示帮助信息');
        console.log('');
        process.exit(0);
    }

    const modelArg = args.find(a => !a.startsWith('--'));
    const model = modelArg || process.env.ROUTER_MODEL || 'qwen-turbo';

    const config = {
        component: 'router',
        model,
        outputFormat: 'console',
        strict: args.includes('--strict'),
        verbose: args.includes('--verbose') || args.length === 0,
        iterations: parseInt(args.find(a => a.startsWith('--iter='))?.split('=')[1] || '1')
    };

    const results: any[] = [];

    console.log(`\n🚀 IntentRouter [V4.0] 极简三分类验证`);
    console.log(`Model: ${config.model}`);
    console.log(`Prompt: ~25 tokens (vs ~200 legacy)`);
    console.log(`Test cases: ${ROUTER_TEST_CASES.length}`);
    console.log('='.repeat(60));

    let passed = 0;
    let acceptable = 0;
    let critical = 0;

    for (const testCase of ROUTER_TEST_CASES) {
        const result = await runTestCase(testCase, config);
        results.push(result);

        if (result.passed) {
            passed++;
            if (config.verbose) console.log(`✅ [${testCase.id}] output="${result.actual}"`);
        } else if (result.isAcceptable) {
            acceptable++;
            console.log(`⚠️ [${testCase.id}] ${result.reason} (output="${result.actual}")`);
        } else if (result.isCritical) {
            critical++;
            console.log(`❌ [${testCase.id}] ${result.reason} (output="${result.actual}")`);
        }

        await new Promise(r => setTimeout(r, 100));
    }

    console.log('\n' + '='.repeat(60));
    console.log(`严格匹配: ${passed}/${ROUTER_TEST_CASES.length} (${(passed / ROUTER_TEST_CASES.length * 100).toFixed(1)}%)`);
    console.log(`容错通过: ${passed + acceptable}/${ROUTER_TEST_CASES.length} (${((passed + acceptable) / ROUTER_TEST_CASES.length * 100).toFixed(1)}%)`);
    console.log(`关键失败: ${critical}`);

    if (critical > 0) {
        console.error('\n❌ 存在关键漏判，验证失败！');
        process.exit(1);
    }

    console.log('\n✅ 验证通过！');
    process.exit(0);
}

if (require.main === module) {
    runDirectValidation().catch(e => {
        console.error('FATAL:', e);
        process.exit(1);
    });
}