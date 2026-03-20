import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';

/**
 * [V3.2] 架构路由逻辑验证脚本
 */

const WORKSPACE = path.join(process.cwd(), 'temp_test_workspace');
if (!fs.existsSync(WORKSPACE)) fs.mkdirSync(WORKSPACE, { recursive: true });

const mockConfig: PluginConfig = {
    zego: { appId: 0, serverSecret: '', aiAgentBaseUrl: '' },
    llm: { 
        provider: 'openai', 
        apiKey: process.env.OPENAI_API_KEY || 'sk-xxxx', 
        model: 'qwen-turbo', 
        baseUrl: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1' 
    },
    tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
    fastAgent: {
        slcModel: 'qwen-turbo',
        sleModel: 'qwen-plus'
    }
};

async function runV32FlowTest() {
    console.log('🚀 [V3.2 Flow Test] Starting...');
    
    // 实例化
    const agent = new FastAgentV3(mockConfig, WORKSPACE);
    const callId = `flow-test-${Date.now()}`;
    
    const notifications: string[] = [];
    const notifier = async (text: string) => {
        console.log(`[TTS] 🎙️: "${text}"`);
        notifications.push(text);
    };

    console.log('\n--- Test 1: Chat Mode (No Tool) ---');
    await agent.process(
        [{ role: 'user', content: '你好，Jarvis。' }],
        (chunk) => {
            if (chunk.type === 'text') process.stdout.write(chunk.content);
        },
        notifier,
        callId
    );
    console.log('\n✅ Chat Mode finished.');

    console.log('\n--- Test 2: Tool Mode (Need Tool) ---');
    await agent.process(
        [{ role: 'user', content: '帮我查一下当前目录下的文件。' }],
        (chunk) => {
            if (chunk.type === 'text') process.stdout.write(chunk.content);
        },
        notifier,
        callId
    );
    console.log('\n✅ Tool Mode initiated (SLC should have padded).');
    
    console.log('\n--- Test 3: Idle Trigger (15s) ---');
    console.log('Waiting 16 seconds for idle greeting...');
    await new Promise(resolve => setTimeout(resolve, 16000));

    // 清理
    agent.destroy();
    console.log('\n✨ [V3.2 Flow Test] Finished.');
}

runV32FlowTest().catch(console.error);
