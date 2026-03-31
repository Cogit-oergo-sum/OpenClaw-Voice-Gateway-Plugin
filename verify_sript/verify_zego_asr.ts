import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CallManager } from '../src/call/call-manager';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DelegateExecutor } from '../src/agent/executor';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import * as path from 'path';

async function verifyZegoAsr() {
    console.log("=== [ZEGO ASR Correction Scenario Test] ===");

    const workspaceRoot = path.resolve("./tmp_workspace_zego");
    const callManager = new CallManager({ zego: {}, llm: {}, tts: {} } as any);
    const canvasManager = new CanvasManager(workspaceRoot);
    const executor = {} as DelegateExecutor;
    const summarizer = {} as ResultSummarizer;

    // 模拟重写 ZegoApiClient.updateAgentHotwords 捕获调用
    let lastHotwords: any = {};
    (callManager.api as any).updateAgentHotwords = async (hotwords: any) => {
        lastHotwords = hotwords;
        console.log("[Mock API] Updated Hotwords:", JSON.stringify(hotwords));
    };

    const trh = new ToolResultHandler(executor, summarizer, workspaceRoot, callManager);

    // 等待异步加载的动态技能完成
    await new Promise(resolve => setTimeout(resolve, 800));

    const userId = "zego-user-123";
    callManager.createCall(userId);
    const canvas: any = { task_status: { status: 'IDLE' } };

    // 模拟 ASR 纠错调用
    console.log("\nSimulating ASR Correction Tool Call...");
    console.log("Input: 机构科技 -> 即构科技");

    const toolCall = {
        function: {
            name: 'correct_asr_hotword',
            arguments: JSON.stringify({ wrong: "机构科技", correct: "即构科技" })
        }
    };

    let eventLog: any[] = [];
    (canvasManager as any).logCanvasEvent = async (id: string, event: string, detail: any) => {
        eventLog.push({ event, detail });
        console.log(`[CanvasEvent] ${event}:`, JSON.stringify(detail));
    };

    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasManager);

    console.log("\n--- Verification Results ---");

    // 1. 检查 API 是否调用了热词更新
    if (lastHotwords["即构科技"]) {
        console.log(`✅ Hotword "即构科技" weight updated to ${lastHotwords["即构科技"]}`);
    } else {
        console.error("❌ Hotword update failed!");
    }

    // 2. 检查 AliasMap 是否记录了映射
    const callState = callManager.getCallState(userId);
    if (callState?.aliasMap.get("机构科技") === "即构科技") {
        console.log("✅ AliasMap recorded: 机构科技 -> 即构科技");
    } else {
        console.error("❌ AliasMap record failed!");
    }

    // 3. 检查 Canvas 事件
    const correctedEvent = eventLog.find(e => e.event === 'ASR_CORRECTED');
    if (correctedEvent) {
        console.log("✅ ASR_CORRECTED event logged.");
        console.log("Direct Response preview:", canvas.task_status.direct_response);
    } else {
        console.error("❌ ASR_CORRECTED event missing!");
    }

    console.log("\n=== Test Finished ===");
}

verifyZegoAsr().catch(e => {
    console.error(e);
    process.exit(1);
});
