import * as dotenv from 'dotenv';
import { IntentRouter } from '../src/agent/intent-router';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowManager } from '../src/agent/shadow-manager';
import { RouterResult } from '../src/agent/types';
import { PluginConfig } from '../src/types/config';

dotenv.config();

/**
 * [IntentRouter 优化] 基准准确率测试脚本
 * 重点验证多轮对话场景的指代消解和上下文理解
 */

// 测试用例定义
interface TestCase {
    id: string;
    input: string;
    canvasSnapshot?: { tasks: any[] };  // 模拟画布状态
    dialogueHistory?: string[];          // 前置对话历史
    expected: Partial<RouterResult>;     // 期望输出
    category: string;                    // 场景分类
}

// 基准测试集
const BENCHMARK_SUITE: TestCase[] = [
    // === 闲聊场景 ===
    {
        id: 'CHAT-01',
        input: '你好',
        expected: { intents: [] },
        category: '闲聊'
    },
    {
        id: 'CHAT-02',
        input: '今天天气不错啊',
        expected: { intents: [] },
        category: '闲聊'
    },
    {
        id: 'CHAT-03',
        input: '有点累',
        expected: { intents: [] },
        category: '闲聊'
    },

    // === 新任务场景 ===
    {
        id: 'TASK-01',
        input: '帮我查一下天气',
        expected: { intents: [{ type: 'NEW_TASK', task_name: '天气' }] },
        category: '新任务'
    },
    {
        id: 'TASK-02',
        input: '创建一个文档',
        expected: { intents: [{ type: 'NEW_TASK', task_name: '文档' }] },
        category: '新任务'
    },
    {
        id: 'TASK-03',
        input: '帮我整理一下文件',
        expected: { intents: [{ type: 'NEW_TASK', task_name: '文件' }] },
        category: '新任务'
    },

    // === 多轮指代场景（重点验证）===
    {
        id: 'MULTI-01',
        input: '取消它',
        dialogueHistory: ['帮我创建test.md文件'],
        canvasSnapshot: { tasks: [{ id: 't_01', name: '创建test.md', status: 'PENDING' }] },
        expected: { intents: [{ type: 'CANCEL_TASK' }] },
        category: '多轮指代'
    },
    {
        id: 'MULTI-02',
        input: '结果怎么样',
        dialogueHistory: ['帮我查一下北京天气'],
        canvasSnapshot: { tasks: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京今天晴天20度' }] },
        expected: { isAnswerInActiveCanvas: true },
        category: '多轮指代'
    },
    {
        id: 'MULTI-03',
        input: '继续刚才的任务',
        dialogueHistory: ['帮我整理文档'],
        expected: { intents: [{ type: 'NEW_TASK', task_name: '文档' }] },
        category: '多轮指代'
    },
    {
        id: 'MULTI-04',
        input: '那个文件',
        dialogueHistory: ['我要创建一个配置文件'],
        expected: { intents: [{ type: 'CLARIFY' }] },  // 或 NEW_TASK，需根据上下文判断
        category: '多轮指代'
    },

    // === 画布引用场景 ===
    {
        id: 'REF-01',
        input: '刚才的任务怎么样了',
        canvasSnapshot: { tasks: [{ id: 't_01', name: '天气查询', status: 'READY' }] },
        expected: { isAnswerInActiveCanvas: true },
        category: '画布引用'
    },
    {
        id: 'REF-02',
        input: '之前的任务完成了吗',
        canvasSnapshot: { tasks: [{ id: 't_01', name: '文件整理', status: 'COMPLETED' }] },
        expected: { isAnswerInActiveCanvas: true },
        category: '画布引用'
    },

    // === 取消任务场景 ===
    {
        id: 'CANCEL-01',
        input: '取消刚才的任务',
        canvasSnapshot: { tasks: [{ id: 't_01', name: '天气查询', status: 'PENDING' }] },
        expected: { intents: [{ type: 'CANCEL_TASK' }] },
        category: '取消任务'
    },

    // === 澄清场景 ===
    {
        id: 'CLARIFY-01',
        input: '那个文档',  // 无明确上下文
        expected: { intents: [{ type: 'CLARIFY' }] },
        category: '需澄清'
    }
];

// 比较结果
function compareResult(actual: RouterResult, expected: Partial<RouterResult>): boolean {
    // 检查 intents
    if (expected.intents) {
        if (actual.intents.length !== expected.intents.length) return false;
        for (let i = 0; i < expected.intents.length; i++) {
            const expIntent = expected.intents[i];
            const actIntent = actual.intents[i];
            if (expIntent.type && actIntent.type !== expIntent.type) return false;
            // 任务名称宽松匹配（包含关键词即可）
            if (expIntent.task_name && !actIntent.task_name?.includes(expIntent.task_name)) {
                // 宽松检查：只要语义相近即可
                const keywords = expIntent.task_name.split('');
                const hasKeyword = keywords.some(k => actIntent.task_name?.includes(k));
                if (!hasKeyword && actIntent.task_name) return false;
            }
        }
    }

    // 检查 isAnswerInActiveCanvas
    if (expected.isAnswerInActiveCanvas !== undefined) {
        if (actual.isAnswerInActiveCanvas !== expected.isAnswerInActiveCanvas) return false;
    }

    return true;
}

// 主测试函数
async function runAccuracyBenchmark(model?: string): Promise<{ accuracy: number; passed: number; failed: number; details: string[] }> {
    const config: PluginConfig = {
        llm: {
            provider: 'openai',
            apiKey: process.env.BAILIAN_API_KEY || process.env.FAST_AGENT_API_KEY || '',
            model: model || process.env.ROUTER_MODEL || 'qwen-turbo',
            baseUrl: process.env.BAILIAN_BASE_URL || process.env.FAST_AGENT_BASE_URL || ''
        },
        tts: { vendor: 'dummy', appId: '', token: '', voiceType: '', resourceId: '' },
        fastAgent: {
            routerModel: model || process.env.ROUTER_MODEL || 'qwen-turbo',
            sleBaseUrl: process.env.BAILIAN_BASE_URL || process.env.FAST_AGENT_BASE_URL
        }
    };

    // 初始化依赖组件（简化版）
    const workspaceRoot = process.env.WORKSPACE_ROOT || '/tmp/test_workspace';
    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const canvasManager = new CanvasManager(workspaceRoot);
    const shadowManager = new ShadowManager(workspaceRoot);
    const promptAssembler = new PromptAssembler(workspaceRoot, dialogueMemory, canvasManager, shadowManager);
    const router = new IntentRouter(config);

    let passed = 0;
    let failed = 0;
    const details: string[] = [];

    console.log(`\n🚀 Running Router Accuracy Benchmark (Model: ${model || 'default'})`);
    console.log('='.repeat(60));

    for (const test of BENCHMARK_SUITE) {
        // 模拟画布状态
        if (test.canvasSnapshot) {
            // CanvasManager 需要支持设置测试状态
            // 这里简化处理，实际需要 mock
        }

        try {
            const result = await router.detectIntent(
                test.input,
                (test.dialogueHistory || []).map(h => ({ role: 'user', content: h })),
                promptAssembler,
                'test_call_' + test.id
            );

            const match = compareResult(result, test.expected);

            if (match) {
                passed++;
                details.push(`✅ [${test.id}] ${test.category}: "${test.input}" → PASS`);
            } else {
                failed++;
                details.push(`❌ [${test.id}] ${test.category}: "${test.input}"`);
                details.push(`   Expected: ${JSON.stringify(test.expected)}`);
                details.push(`   Actual:   ${JSON.stringify(result)}`);
            }
        } catch (e: any) {
            failed++;
            details.push(`💥 [${test.id}] ${test.category}: "${test.input}" → ERROR: ${e.message}`);
        }

        // 防止 API 限流
        await new Promise(resolve => setTimeout(resolve, 200));
    }

    const accuracy = passed / BENCHMARK_SUITE.length;

    console.log('\n' + details.join('\n'));
    console.log('\n' + '='.repeat(60));
    console.log(`📊 Summary: ${passed}/${BENCHMARK_SUITE.length} passed (${(accuracy * 100).toFixed(1)}%)`);
    console.log(`   Model: ${model || 'default'}`);

    return { accuracy, passed, failed, details };
}

// 分类统计
function getCategoryStats(details: string[]): Record<string, { passed: number; failed: number }> {
    const stats: Record<string, { passed: number; failed: number }> = {};

    for (const line of details) {
        const match = line.match(/\[(\w+-\d+)\] (\w+):/);
        if (match) {
            const category = match[2];
            if (!stats[category]) stats[category] = { passed: 0, failed: 0 };
            if (line.startsWith('✅')) stats[category].passed++;
            else stats[category].failed++;
        }
    }

    return stats;
}

// 入口
async function main() {
    const model = process.argv[2];  // 支持传入模型参数
    const result = await runAccuracyBenchmark(model);

    // 分类统计
    const stats = getCategoryStats(result.details);
    console.log('\n📈 Category Breakdown:');
    for (const [cat, data] of Object.entries(stats)) {
        const catAcc = data.passed / (data.passed + data.failed) * 100;
        console.log(`   ${cat}: ${data.passed}/${data.passed + data.failed} (${catAcc.toFixed(1)}%)`);
    }

    // 多轮指代准确率（重点指标）
    const multiStats = stats['多轮指代'] || { passed: 0, failed: 0 };
    const multiAcc = multiStats.passed / (multiStats.passed + multiStats.failed) * 100;
    console.log(`\n🎯 Multi-round Reference Accuracy: ${multiAcc.toFixed(1)}% (Target: ≥90%)`);

    // 验证阈值
    if (result.accuracy < 0.95) {
        console.error(`\n❌ Overall accuracy ${(result.accuracy * 100).toFixed(1)}% below threshold 95%`);
        process.exit(1);
    }

    if (multiAcc < 90) {
        console.error(`\n⚠️ Multi-round accuracy ${multiAcc.toFixed(1)}% below target 90%`);
        // 不强制退出，但给出警告
    }

    console.log('\n✅ Accuracy benchmark passed!');
    process.exit(0);
}

main().catch(e => {
    console.error('FATAL ERROR:', e);
    process.exit(1);
});