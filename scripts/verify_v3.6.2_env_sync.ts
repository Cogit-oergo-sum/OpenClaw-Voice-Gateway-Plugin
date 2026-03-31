import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
    const workspaceRoot = path.resolve(__dirname, '../../openclaw-test-env/workspace');
    const logFile = path.join(workspaceRoot, 'logs/canvas.jsonl');

    // 清理之前的日志以便验证
    if (fs.existsSync(logFile)) fs.unlinkSync(logFile);

    const config: any = {
        llm: {
            provider: 'openai',
            apiKey: process.env.OPENAI_API_KEY || 'dummy',
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            model: 'gpt-4o-mini'
        },
        fastAgent: {
            slcModel: 'gpt-4o-mini',
            sleModel: 'gpt-4o-mini'
        }
    };

    const agent = new FastAgentV3(config, workspaceRoot);
    const callId = `test-sync-${Date.now()}`;

    console.log(`[Test] Starting process for callId: ${callId}`);
    
    // 我们只需要观察初始化阶段的日志
    await agent.process('你好', (chunk) => {
        // console.log('SLC Chunk:', chunk.content);
    }, undefined, callId);

    // 等待异步初始化完成 (IntentRouter.initializeSession 是异步且未等待的，我们在测试里通融一下)
    await new Promise(resolve => setTimeout(resolve, 3000));

    if (!fs.existsSync(logFile)) {
        console.error('FAILED: log file not created');
        return;
    }

    const lines = fs.readFileSync(logFile, 'utf8').split('\n').filter(Boolean);
    const initEvent = lines.find(l => l.includes('SESSION_INITIALIZED'));
    
    if (initEvent) {
        const data = JSON.parse(initEvent);
        console.log('[Verified] SESSION_INITIALIZED detail:', JSON.stringify(data.detail, null, 2));
        console.log('[Verified] Canvas Env State:', JSON.stringify(data.state.env, null, 2));
        
        const summary = data.detail.summary;
        if (summary.includes('暂缺')) {
            console.error('FAILED: Summary still says "information missing"');
        } else {
            console.log('SUCCESS: Summary correctly reflects environment info.');
        }

        if (data.state.env.time) {
            console.log('SUCCESS: Canvas env time is populated:', data.state.env.time);
        } else {
            console.error('FAILED: Canvas env time is still empty');
        }
    } else {
        console.error('FAILED: SESSION_INITIALIZED event not found');
    }
}

main().catch(console.error);
