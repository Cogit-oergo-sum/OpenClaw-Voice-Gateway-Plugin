
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';
import * as fs from 'fs';
import * as path from 'path';

// 验证脚本：V3.6.13 Watchdog 隔离与身份验证
async function main() {
    const workspaceRoot = path.join(__dirname, '../openclaw-test-env/workspace_verify');
    if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });

    const config: PluginConfig = {
        llm: { provider: 'openai', apiKey: 'mock', model: 'gpt-3.5-turbo', baseUrl: 'http://localhost:1111/v1' }, // 这里用无效地址防止真的发请求
        fastAgent: { version: 'v3', slcModel: 'qwen-turbo' }
    } as any;

    console.log("🚀 [Verify] Starting Watchdog Verification...");
    const agent = new FastAgentV3(config, workspaceRoot);

    const logs: string[] = [];
    const mockNotifier = async (text: string) => {
        logs.push(text);
        console.log(`[Verify] Notifier Received: ${text}`);
    };

    // 1. 注册两个会话：global(应被屏蔽) 和 real-user(应正常触发)
    // 注意：目前的 registerNotifier 是私有的，通过调用一次 process 间接注入
    console.log("[Verify] Initializing global session...");
    await agent.process("__INIT__", () => {}, mockNotifier, "global");
    
    console.log("[Verify] Initializing real-user session...");
    await agent.process("hello", () => {}, mockNotifier, "real-user");
    
    // 手动通过 CanvasManager 设置 READY 状态，绕过由于 LLM 失败导致的初始化锁定
    const canvas = (agent as any).canvasManager.getCanvas("real-user");
    canvas.task_status.status = 'READY';
    canvas.task_status.is_delivered = true;
    canvas.task_status.version = Date.now() + 1000; // 确保版本领先
    await (agent as any).canvasManager.persistContext("real-user");
    console.log("[Verify] Manually set real-user to READY/Delivered and persisted.");

    console.log("[Verify] Waiting 15s for Watchdog to scan (Threshold is 10s)...");
    
    // 清空 llm_requests.log 方便后续核对
    const llmLogPath = path.join(process.cwd(), '.llm_requests.log');
    if (fs.existsSync(llmLogPath)) fs.writeFileSync(llmLogPath, '');

    await new Promise(resolve => setTimeout(resolve, 15000));

    console.log("🏁 [Verify] Time's up. Analyzing results...");

    const llmLogContent = fs.existsSync(llmLogPath) ? fs.readFileSync(llmLogPath, 'utf8') : '';
    const llmEntries = llmLogContent.trim().split('\n').filter(l => l).map(l => JSON.parse(l));

    const globalIdleLogs = llmEntries.filter(e => e.callId === 'global' && e.source === 'Watchdog-Idle');
    const realUserIdleLogs = llmEntries.filter(e => e.callId === 'real-user' && e.source === 'Watchdog-Idle');

    console.log(`[Result] Global Idle Triggers: ${globalIdleLogs.length} (Expected: 0)`);
    console.log(`[Result] Real-User Idle Triggers: ${realUserIdleLogs.length} (Expected: >0)`);

    let success = true;
    if (globalIdleLogs.length > 0) {
        console.error("❌ FAIL: Global session triggered idle greeting!");
        success = false;
    }
    if (realUserIdleLogs.length === 0) {
        console.error("❌ FAIL: Real user session NOT triggered idle greeting!");
        success = false;
    }

    if (success) {
        console.log("✅ SUCCESS: Watchdog isolation and ID binding verified.");
    }

    agent.destroy();
    process.exit(success ? 0 : 1);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
