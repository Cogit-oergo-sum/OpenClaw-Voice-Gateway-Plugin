
import { ZegoApiClient } from '../src/call/zego-api';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

async function fixTunnel() {
    const tunnelLog = '/tmp/tunnel.log';
    if (!fs.existsSync(tunnelLog)) {
        console.error('Tunnel log not found at /tmp/tunnel.log');
        process.exit(1);
    }

    const content = fs.readFileSync(tunnelLog, 'utf-8');
    const matches = content.match(/https:\/\/[a-z0-9.-]+\.pinggy\.link/g);
    if (!matches || matches.length === 0) {
        console.error('No Pinggy URL found in /tmp/tunnel.log');
        process.exit(1);
    }

    const publicBase = matches[matches.length - 1];
    const llmUrl = `${publicBase}/voice-gateway/chat/completions`;

    console.log(`Detected New Tunnel URL: ${publicBase}`);
    console.log(`Updating Agent Registration with URL: ${llmUrl}`);

    const api = new ZegoApiClient({
        appId: Number(process.env.ZEGO_APP_ID),
        serverSecret: process.env.ZEGO_SERVER_SECRET || '',
        aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL
    } as any);

    const params: any = {
        llmUrl,
        llm: {
            apiKey: process.env.BAILIAN_API_KEY || '',
            model: process.env.BAILIAN_MODEL || 'qwen-plus',
            baseUrl: process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
        },
        tts: {
            vendor: 'ByteDance',
            appId: 'zego_test',
            token: 'zego_test',
            voiceType: 'zh_female_wanwanxiaohe_moon_bigtts'
        }
    };

    try {
        await api.updateAgent(params);
        console.log('✅ Successfully updated agent registration at ZEGO.');
    } catch (err: any) {
        console.error('❌ Failed to update agent:', err.message);
        process.exit(1);
    }
}

fixTunnel();
