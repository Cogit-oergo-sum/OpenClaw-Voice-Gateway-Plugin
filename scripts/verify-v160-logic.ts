import { FastAgent } from '../src/agent/fast-agent';
import { callContextStorage } from '../src/context/ctx';
import { PluginConfig } from '../src/types/config';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();

/**
 * 验证脚本：模拟真实的 RTC 流量入口
 */
async function runVerification() {
    const config: PluginConfig = {
        llm: {
            provider: 'openai',
            apiKey: process.env.BAILIAN_API_KEY || 'no-key',
            baseUrl: process.env.BAILIAN_BASE_URL || 'no-url',
            model: process.env.BAILIAN_MODEL || 'doubao-lite-32k'
        },
        zego: { 
            appId: 0, 
            serverSecret: '', 
            aiAgentBaseUrl: 'http://localhost' 
        },
        tts: { 
            vendor: 'zego',
            appId: '',
            token: '',
            voiceType: ''
        },
        asr: { 
            vendor: 'zego'
        }
    };

    const workspaceRoot = path.resolve(__dirname, '../demo_workspace');
    const agent = new FastAgent(config, workspaceRoot);

    const testScenarios = [
        { id: 'call_101', text: '你好，Jarvis，帮我给张三发个邮件告知他重构进度。' },
        { id: 'call_102', text: '现在几点了？' }
    ];

    for (const scenario of testScenarios) {
        console.log(`\n🚀 [验证场景]: ${scenario.text}`);
        
        // 关键：模拟 AsyncLocalStorage 上下文隔离
        await callContextStorage.run({ 
            callId: scenario.id, 
            userId: 'test_user_01', 
            startTime: Date.now(), 
            metadata: {} 
        }, async () => {
            console.log(`[Context] Active CallID: ${scenario.id}`);
            
            await agent.process(scenario.text, (chunk) => {
                const color = chunk.type === 'filler' ? '\x1b[36m' : 
                              chunk.type === 'bridge' ? '\x1b[33m' : 
                              chunk.type === 'text' ? '\x1b[32m' : '\x1b[90m';
                process.stdout.write(`${color}${chunk.content}\x1b[0m`);
            });
            console.log('\n[√] 会话结束');
        });
    }

    console.log('\n📂 [WAL 状态检查]: 请检查 demo_workspace/states 目录下是否生成了对应的 .wal 和 _shadow.md 文件。');
}

runVerification().catch(console.error);
