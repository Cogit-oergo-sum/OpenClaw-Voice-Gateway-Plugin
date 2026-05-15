import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { FastAgentResponse } from '../src/agent/types';
import { callContextStorage } from '../src/context/ctx';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

// [V4.3] 跳过 Router，验证 SLC → trigger_sle_check → SLE DECIDING 链路
process.env.SKIP_ROUTER = 'true';

interface TestResult {
    input: string;
    slcFullText: string;
    slcTriggeredCheck: boolean;
    sleIntentType: string;
    trace: string[];
    pass: boolean;
}

async function verify() {
    console.log('=== V4.3 SLC→SLE 意图校验链路验证 ===');
    console.log('SKIP_ROUTER=true, Router 强制返回 chat\n');

    const config = {
        llm: {
            apiKey: process.env.BAILIAN_API_KEY,
            baseUrl: process.env.BAILIAN_BASE_URL,
            model: process.env.BAILIAN_MODEL || 'qwen-plus',
            provider: 'bailian'
        },
        fastAgent: {
            slcModel: process.env.SLC_MODEL || 'qwen-turbo',
            slcBaseUrl: process.env.SLC_BASE_URL || process.env.BAILIAN_BASE_URL,
            sleModel: process.env.BAILIAN_MODEL || 'qwen-plus',
            sleBaseUrl: process.env.BAILIAN_BASE_URL
        },
        zego: {
            appId: Number(process.env.ZEGO_APP_ID || 0),
            serverSecret: process.env.ZEGO_SERVER_SECRET || '',
            aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL || ''
        }
    };

    const workspaceRoot = process.env.OPENCLAW_WORKSPACE || path.join(__dirname, '..');
    const agent = new FastAgentV3(config as any, workspaceRoot);

    // 等待初始化
    await new Promise(r => setTimeout(r, 2000));

    const testCases = [
        {
            input: '帮我查一下深圳今天的天气怎么样',
            expectTrigger: true,   // SLC 应触发 trigger_sle_check
            expectIntent: 'NEW',   // SLE 应判定 NEW
            label: '工具意图(查天气)'
        },
        {
            input: '你好呀，今天心情不错呢',
            expectTrigger: false,  // SLC 不应触发（或 SLE 判定 NONE）
            expectIntent: 'NONE',
            label: '纯闲聊'
        }
    ];

    const results: TestResult[] = [];

    for (const tc of testCases) {
        console.log(`\n--- 测试: ${tc.label} ---`);
        console.log(`输入: "${tc.input}"`);

        let slcFullText = '';
        let slcTriggeredCheck = false;
        let sleIntentType = 'UNKNOWN';
        const trace: string[] = [];

        const callId = `verify-v43-${Date.now()}`;

        // 拦截 console.log 以捕获 SLC_CHECK 和 SLE check result
        const origLog = console.log;
        const capturedLogs: string[] = [];
        console.log = (...args: any[]) => {
            const msg = args.join(' ');
            capturedLogs.push(msg);
            origLog.apply(console, args);

            // 检测 SLC 触发 trigger_sle_check
            if (msg.includes('SLC_CHECK') || msg.includes('触发 SLE 意图校验')) {
                slcTriggeredCheck = true;
            }
            // 检测 SLE 判定结果
            if (msg.includes('SLE check result:')) {
                const match = msg.match(/SLE check result:\s*(\w+)/);
                if (match) sleIntentType = match[1];
            }
        };

        try {
            await callContextStorage.run({
                callId,
                userId: 'verify-v43',
                startTime: Date.now(),
                metadata: {}
            }, async () => {
                await agent.process(tc.input, (chunk: FastAgentResponse) => {
                    if (chunk.content && chunk.type !== 'thought') {
                        slcFullText += chunk.content;
                    }
                    if (chunk.trace) {
                        trace.push(...chunk.trace);
                    }
                }, async (text: string) => {
                    origLog(`[异步通知] ${text}`);
                });
            });

            // handleSLCCheck 是异步 fire-and-forget，process() 不会等它完成
            // 如果 SLC 触发了 trigger_sle_check，需等待 SLE DECIDING 执行完毕
            if (slcTriggeredCheck) {
                origLog('[等待] SLE DECIDING 异步执行中...');
                for (let i = 0; i < 30; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    if (sleIntentType !== 'UNKNOWN') break;
                }
            }
        } catch (err: any) {
            origLog(`[错误] ${err.message}`);
        }

        console.log = origLog;

        // 判定通过条件
        let pass = false;
        if (tc.expectTrigger) {
            // 期望触发 SLE：SLC 触发 + SLE 判定 NEW
            pass = slcTriggeredCheck && sleIntentType === 'NEW';
        } else {
            // 期望不触发：SLC 不触发，或 SLE 判定 NONE
            pass = !slcTriggeredCheck || sleIntentType === 'NONE';
        }

        const result: TestResult = {
            input: tc.input,
            slcFullText: slcFullText.substring(0, 100),
            slcTriggeredCheck,
            sleIntentType,
            trace,
            pass
        };
        results.push(result);

        origLog(`SLC 输出: "${result.slcFullText}"`);
        origLog(`SLC 触发 trigger_sle_check: ${slcTriggeredCheck}`);
        origLog(`SLE 判定 intent_type: ${sleIntentType}`);
        origLog(`Trace: ${trace.join(' → ')}`);
        origLog(`结果: ${pass ? '✅ PASS' : '❌ FAIL'}`);
    }

    // 汇总
    console.log('\n=== 验证汇总 ===');
    for (const r of results) {
        console.log(`${r.pass ? '✅' : '❌'} "${r.input}" | SLC触发=${r.slcTriggeredCheck} SLE判定=${r.sleIntentType}`);
    }

    const allPass = results.every(r => r.pass);
    console.log(`\n${allPass ? '✅ 全部通过' : '❌ 存在失败'}`);

    agent.destroy();
    process.exit(allPass ? 0 : 1);
}

verify().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
