
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import { PluginConfig } from '../src/types/config';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const workspaceRoot = path.join(__dirname, '../openclaw-test-env/workspace_cleanup');
    if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });

    const config: PluginConfig = {
        llm: { provider: 'openai', apiKey: 'mock', model: 'gpt-3.5-turbo', baseUrl: 'http://localhost:1111/v1' },
        fastAgent: { version: 'v3', slcModel: 'qwen-turbo' }
    } as any;

    console.log("🚀 [Verify] Starting Session Cleanup Verification...");
    const agent = new FastAgentV3(config, workspaceRoot);

    const callId = "zombie-call";
    const logs: string[] = [];
    const mockNotifier = async (text: string) => {
        logs.push(text);
        console.log(`[Verify] Notifier Received: ${text}`);
    };

    // 1. 正常注册并预案 Ready 状态
    await agent.process("hello", () => {}, mockNotifier, callId);
    const canvas = (agent as any).canvasManager.getCanvas(callId);
    canvas.task_status.status = 'READY';
    canvas.task_status.is_delivered = true;
    await (agent as any).canvasManager.persistContext(callId);

    // 校验注册成功
    const watchdog = (agent as any).watchdog;
    if (watchdog.getNotifier(callId)) {
        console.log("✅ Session registered in Watchdog.");
    } else {
        throw new Error("Failed to register session.");
    }

    // 2. 执行销毁
    console.log("[Verify] Calling destroySession...");
    await agent.destroySession(callId);

    // 校验销毁成功
    if (!watchdog.getNotifier(callId)) {
        console.log("✅ Session unregistered from Watchdog.");
    } else {
         throw new Error("Failed to unregister session.");
    }
    
    if (!(agent as any).canvasManager.getCanvases().has(callId)) {
        console.log("✅ Canvas removed from Memory.");
    } else {
         throw new Error("Failed to remove canvas from memory.");
    }

    // 3. 等待一段时间，确保不会有 Idle 触发
    console.log("[Verify] Waiting 12s (threshold is 10s) to ensure NO idle triggers...");
    await new Promise(resolve => setTimeout(resolve, 12000));

    if (logs.length === 0) {
        console.log("✅ SUCCESS: No idle triggers after session destruction.");
    } else {
        console.error("❌ FAIL: Idle triggered after session was supposed to be destroyed!");
        process.exit(1);
    }

    agent.destroy();
    process.exit(0);
}

main().catch(e => {
    console.error(e);
    process.exit(1);
});
