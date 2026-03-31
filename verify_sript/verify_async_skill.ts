import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CanvasManager } from '../src/agent/canvas-manager';

/**
 * [V3.5.0] verify_async_skill.ts
 * 验证非阻塞异步流转心脏逻辑。
 */
async function verifyAsyncSkill() {
    console.log("=== [V3.5 Async Skill Verification Start] ===");

    const workspace = "./test_workspace_v3.5";
    const canvasMgr = new CanvasManager(workspace);

    // Mock ResultSummarizer to avoid OpenAI calls
    const mockSummarizer = {
        summarizeTaskResult: async (raw: string, intent: string) => {
            console.log(`[MockSummarizer] Summarizing: ${raw.substring(0, 30)}...`);
            return {
                direct_response: "✅ 异步任务已完成 (已摘要)",
                extended_context: "详细背景回馈: " + raw.substring(0, 50)
            };
        }
    } as any;

    const mockExecutor = {} as any;
    // ToolResultHandler 在初始化时会注册 SleepSkill
    const trh = new ToolResultHandler(mockExecutor, mockSummarizer);

    const callId = "test-session-v35";
    const canvas = canvasMgr.getCanvas(callId);

    // 监听 Canvas 事件日志，统计事件
    const events: any[] = [];
    const originalLog = canvasMgr.logCanvasEvent.bind(canvasMgr);
    canvasMgr.logCanvasEvent = async (id, event, detail) => {
        console.log(`[Canvas Event Capture] ${event}: ${JSON.stringify(detail).substring(0, 100)}...`);
        events.push({ event, detail, timestamp: Date.now() });
        return originalLog(id, event, detail);
    };

    // 1. 触发异步任务 (SleepSkill, 设定 3 秒)
    const toolCall = {
        function: {
            name: 'sleep_task',
            arguments: JSON.stringify({ duration_ms: 3000, task_name: "异步耗时检索压力测试" })
        }
    };

    console.log("\n[Phase 1] Triggering async tool call (Expect non-blocking)...");
    const startTime = Date.now();

    // 调用 handleToolCalls，它应该立即返回
    await trh.handleToolCalls([toolCall], "帮我查下那个很大的耗时任务", callId, canvas, canvasMgr);

    const endTime = Date.now();
    const duration = endTime - startTime;

    console.log(`[Phase 1] handleToolCalls return cost: ${duration}ms`);

    if (duration < 800) {
        console.log("✅ OK: handleToolCalls returned immediately.");
    } else {
        throw new Error(`❌ FAIL: handleToolCalls blocked for ${duration}ms!`);
    }

    // 2. 检查 PENDING_ASYNC 状态是否已立即写入
    const pendingEvent = events.find(e => e.event === 'CANVAS_PENDING_ASYNC');
    if (pendingEvent) {
        console.log("✅ OK: Found CANVAS_PENDING_ASYNC event.");
    } else {
        throw new Error("❌ FAIL: CANVAS_PENDING_ASYNC event not found!");
    }

    // 3. 验证主循环未被死锁 (模拟 6 次心跳，共 3 秒)
    console.log("\n[Phase 2] Simulating Main Loop Activity (Heartbeats)...");
    for (let i = 1; i <= 6; i++) {
        await new Promise(resolve => setTimeout(resolve, 500));
        process.stdout.write(`[MainLoop Tick ${i}] `);

        // 在 Tick 期间，Skill 结果不应该出现
        const checkDone = events.find(e => e.event === 'CANVAS_RECOVERY_DONE');
        if (i < 5 && checkDone) {
            console.log("\n⚠️ Warning: Task finished too early?");
        }
    }
    console.log("\n[Phase 2] Heartbeat check finished. Main loop survived.");

    // 4. 等待异步任务最终完成并检查结果注入
    console.log("\n[Phase 3] Waiting for final status recovery (Canvas Silent Update)...");

    let recoveryFound = false;
    for (let retry = 0; retry < 5; retry++) {
        const recoveryEvent = events.find(e => e.event === 'CANVAS_RECOVERY_DONE');
        if (recoveryEvent) {
            console.log(`\n✅ OK: Found CANVAS_RECOVERY_DONE at ${Date.now() - startTime}ms`);
            console.log("Recovery Payload:", JSON.stringify(recoveryEvent.detail.summary));
            recoveryFound = true;
            break;
        }
        process.stdout.write(".");
        await new Promise(resolve => setTimeout(resolve, 1000));
    }

    if (!recoveryFound) {
        throw new Error("❌ FAIL: Async skill result never recovered to Canvas!");
    }

    // 5. 验证最终 Canvas 内存快照
    const finalCanvas = canvasMgr.getCanvas(callId);
    console.log("\n[Phase 4] Final Canvas Integrity Check:");
    console.log("- Status:", finalCanvas.task_status.status);
    console.log("- Delivered:", finalCanvas.task_status.is_delivered);
    console.log("- Summary:", finalCanvas.task_status.summary);

    if (finalCanvas.task_status.status === 'READY' && finalCanvas.task_status.summary.includes("已摘要")) {
        console.log("✅ OK: Canvas state fully recovered to READY via background push.");
    } else {
        throw new Error(`❌ FAIL: Canvas state inconsistent! Status: ${finalCanvas.task_status.status}`);
    }

    console.log("\n=== [V3.5 Async Heartbeat Architecture Verified] ===");
    process.exit(0);
}

verifyAsyncSkill().catch(e => {
    console.error("\n❌ Verification Crashed:", e);
    process.exit(1);
});
