import * as dotenv from 'dotenv';
import { IntentRouter } from '../src/agent/intent-router';
import { PluginConfig } from '../src/types/config';

dotenv.config();

/**
 * [V3.3.0] Stage 2: IntentRouter 验证脚本
 */
async function verify() {
    console.log("🚀 Starting IntentRouter Verification (Stage 2)...");

    const config: PluginConfig = {
        zego: {
            appId: Number(process.env.ZEGO_APP_ID || 0),
            serverSecret: process.env.ZEGO_SERVER_SECRET || '',
            aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL || ''
        },
        llm: {
            provider: 'openai',
            apiKey: process.env.FAST_AGENT_API_KEY || process.env.BAILIAN_API_KEY || '',
            model: process.env.FAST_AGENT_MODEL || process.env.BAILIAN_MODEL || 'qwen-plus',
            baseUrl: process.env.FAST_AGENT_BASE_URL || process.env.BAILIAN_BASE_URL || ''
        },
        tts: { vendor: 'dummy', appId: '', token: '', voiceType: '' },
        fastAgent: {
            sleModel: process.env.FAST_AGENT_SLE_MODEL,
            sleBaseUrl: process.env.FAST_AGENT_BASE_URL
        }
    };

    const router = new IntentRouter(config);

    // Test 1: Chat Intent
    console.log("\n--- Test 1: Chat Mode ---");
    const res1 = await router.detectIntent("你好", [], "你是 Jarvis。用户是先生。");
    console.log(`Input: "你好" -> Result:`, res1);
    if (res1.needsTool === false) {
        console.log("✅ Chat Mode detection passed.");
    } else {
        console.error("❌ Chat Mode detection failed.");
    }

    // Test 2: Tool Intent
    console.log("\n--- Test 2: Tool Mode ---");
    const res2 = await router.detectIntent("帮我查看doc目录下的文件", [], "你是 Jarvis。用户是先生。");
    console.log(`Input: "帮我查看doc目录下的文件" -> Result:`, res2);
    if (res2.needsTool === true) {
        console.log("✅ Tool Mode detection passed.");
    } else {
        console.error("❌ Tool Mode detection failed.");
    }

    console.log("\n🚀 Verification Finished.");
}

verify().catch(e => {
    console.error("FATAL ERROR:", e);
    process.exit(1);
});
