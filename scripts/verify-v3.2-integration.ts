import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';

// 加载环境变量
dotenv.config();

/**
 * [V3.2] 真实环境验证脚本 (类型对齐版)
 */

const WORKSPACE = path.join(process.cwd(), 'temp_test_workspace');
if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });

const mockConfig: PluginConfig = {
    zego: { 
        appId: parseInt(process.env.ZEGO_APP_ID || '0'), 
        serverSecret: process.env.ZEGO_SERVER_SECRET || '', 
        aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL || '' 
    },
    llm: { 
        provider: 'openai', 
        apiKey: process.env.FAST_AGENT_API_KEY || process.env.BAILIAN_API_KEY || 'sk-xxxx', 
        model: process.env.FAST_AGENT_SLE_MODEL || 'qwen-plus', 
        baseUrl: process.env.FAST_AGENT_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1' 
    },
    tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
    fastAgent: {
        slcModel: process.env.FAST_AGENT_SLC_MODEL || 'qwen-turbo',
        sleModel: process.env.FAST_AGENT_SLE_MODEL || 'qwen-plus'
    }
};

async function runV32FlowTest() {
    console.log('🚀 [V3.2 Real-Env Verification] Starting...');
    console.log(`Using Model: ${mockConfig.fastAgent?.sleModel} / ${mockConfig.fastAgent?.slcModel}`);
    
    const agent = new FastAgentV3(mockConfig, WORKSPACE);
    const callId = `verify-env-${Date.now()}`;
    
    const notifications: string[] = [];
    const notifier = async (text: string) => {
        console.log(`[TTS] 🎙️ AI Voice Output: "${text}"`);
        notifications.push(text);
    };

    console.log('\n--- Case 1: Time Inquiry (Internal Canvas Data) ---');
    console.log('Expectation: Should NOT call tool, should use current time from env.');
    await agent.process(
        [{ role: 'user', content: '现在几点了？' }],
        (chunk) => {
            if (chunk.type === 'thought') process.stdout.write(`\n[Thought] ${chunk.content}\n`);
            if (chunk.type === 'text') process.stdout.write(chunk.content);
        },
        notifier,
        callId
    );

    console.log('\n--- Case 2: Tool Mode (Search Files) ---');
    console.log('Expectation: Should call delegate_openclaw, SLC pads with waiting message.');
    await agent.process(
        [{ role: 'user', content: '帮我查一下 doc 目录下有哪些文件。' }],
        (chunk) => {
            if (chunk.type === 'thought') process.stdout.write(`\n[Thought] ${chunk.content}\n`);
            if (chunk.type === 'text') process.stdout.write(`[SLC Padding/Reply] ${chunk.content}`);
        },
        notifier,
        callId
    );

    console.log('\nWaiting for background tool execution & Watchdog scan...');
    // 等待让异步工具执行完成并触发 Watchdog 通报结果
    await new Promise(resolve => setTimeout(resolve, 8000));
    
    console.log('\n--- Case 3: Idle Greeting (15s Silence) ---');
    console.log('Waiting 16 seconds for idle greeting...');
    await new Promise(resolve => setTimeout(resolve, 16000));

    // 打印捕获到的通知
    console.log('\nSummary of Notifications Caught:', notifications);

    agent.destroy();
    console.log('\n✨ [V3.2 Verification Success] All test cases issued.');
    process.exit(0);
}

runV32FlowTest().catch((err) => {
    console.error('Test Failed:', err);
    process.exit(1);
});
