
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function verifyProactiveBroadcast() {
    const workspaceRoot = path.join('/tmp', 'test_workspace_v3.6.4');
    if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });

    const config: PluginConfig = {
        llm: {
            apiKey: process.env.FAST_AGENT_API_KEY || process.env.BAILIAN_API_KEY || 'fake',
            baseUrl: process.env.FAST_AGENT_BASE_URL || process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'qwen-plus'
        },
        fastAgent: {
            slcModel: 'qwen-turbo',
            sleModel: 'qwen-plus'
        }
    } as any;

    console.log('--- Initializing FastAgentV3 ---');
    const agent = new FastAgentV3(config, workspaceRoot);
    const callId = 'test-call-123';

    let notificationReceived = false;
    let notificationText = '';

    const notifier = async (text: string, trace?: string[]) => {
        console.log(`\n[TEST NOTIFIER] 📣 Received: "${text}"`);
        notificationReceived = true;
        notificationText = text;
    };

    // 1. 模拟一个正在进行的任务，并注册通知器
    console.log('--- Step 1: Process initial message to register notifier ---');
    await agent.process('帮我发个邮件', (chunk: any) => {}, notifier, callId);

    // 2. 此时任务应该是 PENDING
    const canvasManager = (agent as any).canvasManager;
    const canvas = canvasManager.getCanvas(callId);
    console.log(`Current Status: ${canvas.task_status.status}, is_delivered: ${canvas.task_status.is_delivered}`);

    // 3. 手动模拟任务完成
    console.log('--- Step 2: Manually set task to READY state ---');
    canvas.task_status.status = 'READY';
    canvas.task_status.is_delivered = false;
    canvas.task_status.summary = '邮件已成功发送给张三，抄送给了李四。';
    canvas.task_status.importance_score = 1.0;
    
    // 强制同步以确保 Watchdog 能读取最新状态
    await (agent as any).canvasManager.appendCanvasAudit(callId, canvas.task_status.summary, 'READY', false);

    console.log('--- Step 3: Wait for Watchdog trigger (Interval is 1000ms) ---');
    
    const startTime = Date.now();
    while (!notificationReceived && Date.now() - startTime < 30000) { // 增加超时到 30s
        await new Promise(resolve => setTimeout(resolve, 500));
        process.stdout.write('.');
    }
    console.log('\n');

    if (notificationReceived) {
        console.log('✅ SUCCESS: Proactive notification received!');
        console.log(`Result: "${notificationText}"`);
        
        // 验证 is_delivered 是否被标记
        if (canvas.task_status.is_delivered) {
            console.log('✅ SUCCESS: task_status.is_delivered is now true.');
        } else {
            console.error('❌ FAILURE: task_status.is_delivered is still false!');
        }
    } else {
        console.error('❌ FAILURE: Timed out waiting for proactive notification.');
    }

    agent.destroy();
}

verifyProactiveBroadcast().catch(console.error);
