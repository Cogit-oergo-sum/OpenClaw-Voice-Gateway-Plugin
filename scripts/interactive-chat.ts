import { FastAgentV3 as FastAgent } from '../src/agent/fast-agent-v3';
import { FastAgentResponse } from '../src/agent/types';
import { callContextStorage } from '../src/context/ctx';
import * as dotenv from 'dotenv';
import * as readline from 'readline';
import * as path from 'path';

dotenv.config();

async function chat() {
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
            appId: Number(process.env.ZEGO_APP_ID),
            serverSecret: process.env.ZEGO_SERVER_SECRET,
            aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL
        }
    };

    const workspaceRoot = process.env.OPENCLAW_WORKSPACE || path.join(__dirname, '..');
    const agent = new FastAgent(config as any, workspaceRoot);
    
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: '\n\x1b[35mUser > \x1b[0m'
    });

    const messages: any[] = [];

    process.stdout.write('\x1b[2J\x1b[0;0H'); // 清屏
    console.log('\x1b[36m%s\x1b[0m', '--- 🚀 OpenClaw Fast Agent 文本交互体验版 ---');
    console.log('您可以直接在此与 Jarvis 进行对话。输入 "exit" 退出。');
    rl.prompt();

    rl.on('line', async (line) => {
        const input = line.trim();
        if (!input) {
            rl.prompt();
            return;
        }
        if (input.toLowerCase() === 'exit' || input.toLowerCase() === 'quit') {
            rl.close();
            return;
        }

        messages.push({ role: 'user', content: input });
        
        process.stdout.write('\x1b[32mJarvis > \x1b[0m');

        let fullResponse = "";
        
        try {
            await callContextStorage.run({ 
                callId: `chat-${Date.now()}`,
                userId: 'dev-user',
                startTime: Date.now(),
                metadata: {}
            }, async () => {
                await agent.process(messages, (chunk: FastAgentResponse) => {
                    if (chunk.content) {
                        process.stdout.write(chunk.content);
                        fullResponse += chunk.content;
                    }
                }, async (text: string) => {
                    console.log(`\n\x1b[33m[异步通知] ${text}\x1b[0m`);
                });
            });
        } catch (err: any) {
            console.error(`\n\x1b[31m[系统错误] ${err.message}\x1b[0m`);
        }

        process.stdout.write('\n');
        messages.push({ role: 'assistant', content: fullResponse });
        rl.prompt();
    }).on('close', () => {
        console.log('\n对话结束。回见，先生。');
        process.exit(0);
    });
}

chat();
