import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';

/**
 * [V3.2] 架构重构专用仿真回归脚本
 * 不依赖 HTTP 网络层，直接实例化 FastAgentV3 门面类进行单元化集成测试。
 */

const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace');
const CANVAS_LOG = path.join(WORKSPACE, 'logs', 'canvas.jsonl');

// 模拟配置
const mockConfig: PluginConfig = {
    zego: { appId: 0, serverSecret: '', aiAgentBaseUrl: '' },
    llm: { provider: 'openai', apiKey: 'sk-mock', model: 'gpt-4o', baseUrl: 'https://api.openai.com/v1' },
    tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
    fastAgent: {
        slcModel: 'gpt-4o-mini',
        sleModel: 'gpt-4o'
    }
};

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runV32Regression() {
    console.log('🚀 [V3.2 Regression] Starting Facade & Sub-module Verification...');
    
    // 初始化门面
    const agent = new FastAgentV3(mockConfig, WORKSPACE);
    const callId = `v32-test-${Date.now()}`;
    
    // 注入一个简单的 notifier 模拟 TTS 播报
    const notifications: string[] = [];
    const notifier = async (text: string) => {
        console.log(`[TTS Notifier] 🎙️: "${text}"`);
        notifications.push(text);
    };

    console.log('\n--- TC-01: SLC Filler & SLE Parallel Execution ---');
    // 模拟用户提问
    await agent.process(
        [{ role: 'user', content: '帮我查一下今天的天气' }],
        (chunk) => {
            // console.log(`[Chunk] ${JSON.stringify(chunk)}`);
        },
        notifier,
        callId
    );
    console.log('✅ Basic Process finished.');

    console.log('\n--- TC-02: Watchdog Event Trigger (Passive Notification) ---');
    // 模拟一个异步任务完成，写入 Canvas 状态
    const readyState = {
        timestamp: new Date().toISOString(),
        callId: callId,
        event: "CANVAS_EXTERNAL_READY_MOCK",
        state: {
            task_status: {
                status: "READY",
                version: Date.now(),
                importance_score: 1.0,
                is_delivered: false,
                summary: "我为您查好了，今天广州天气晴朗，气温 25 度。"
            },
            context: { last_spoken_fragment: "先生，我帮您查查。" }
        }
    };

    // 此时 Watchdog 应该正在运行 (我们在 FastAgentV3 constructor 里启动了它)
    console.log('📡 Injecting READY state to Canvas Log...');
    fs.appendFileSync(CANVAS_LOG, JSON.stringify(readyState) + '\n');
    
    console.log('⏳ Waiting for Watchdog Cycle (Max 10s)...');
    // 循环检查通知是否到达
    let found = false;
    for (let i = 0; i < 15; i++) {
        await sleep(1000);
        if (notifications.some(n => n.includes('广州天气晴朗'))) {
            console.log('✅ Watchdog triggered __INTERNAL_TRIGGER__ and notifier delivered message!');
            found = true;
            break;
        }
    }
    
    if (!found) {
        console.error('❌ TC-02 Failed: Watchdog did not trigger notification within expected time.');
    }

    console.log('\n--- TC-03: TextCleaner & Decant Audit ---');
    const dirtyText = "先生，(潜意识思考: 我得表现得专业点) 我已经帮您处理好了。[调用 openclaw ls]";
    // 这里需要从 ShadowManager 的 log 中验证，或者直接实例化 TextCleaner
    const { TextCleaner } = require('../src/utils/text-cleaner');
    const cleanResult = TextCleaner.decant(dirtyText);
    console.log(`Dirty: "${dirtyText}"`);
    console.log(`Clean: "${cleanResult}"`);
    if (!cleanResult.includes('(') && !cleanResult.includes('[')) {
        console.log('✅ TextCleaner correctly stripped internal thoughts and debug tags.');
    } else {
        console.error('❌ TextCleaner failure.');
    }

    console.log('\n--- TC-04: DelegateExecutor Mock Test ---');
    // 验证超时逻辑 (这部分在 SLE 内部)
    // 我们可以通过 agent.process 传入一个模拟的超长任务来观察
    
    console.log('\n--- Cleaning Up ---');
    agent.destroy();
    console.log('✨ [V3.2 Regression] All tests finished.');
}

runV32Regression().catch(err => {
    console.error('💥 Test Crashed:', err);
    process.exit(1);
});
