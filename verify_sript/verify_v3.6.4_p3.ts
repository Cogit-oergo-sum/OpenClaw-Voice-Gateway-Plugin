import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { CanvasManager } from '../src/agent/canvas-manager';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("=== [V3.6.4 Phase 3 Verification Start] ===");

    const workspace = path.join(process.cwd(), "tmp_verify_v3.6.4_p3");
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    try {
        const canvasMgr = new CanvasManager(workspace);
        const callId = "test_call_v3_6_4_p3";
        const canvas = canvasMgr.getCanvas(callId);

        // 1. Verify Knowledge Routing logic in Orchestrator
        console.log("\n[Test 1] Testing Knowledge Routing...");
        canvas.task_status.summary = "The result is 42.";
        canvas.task_status.status = "READY";

        const slcMock: any = {
            run: async (text, delivered, summary) => {
                return `SLC_PROMPT: ${summary}`;
            }
        };
        const sleMock: any = {
            run: async () => ({ output: "summarized" })
        };
        const intentRouterMock: any = {
            detectIntent: async () => ({ needsTool: false, isAnswerInCanvas: true, intent: "check answer" })
        };
        const assemblerMock: any = {};
        const shadowMock: any = {};
        const memoryMock: any = {
            getHistoryMessages: async () => []
        };

        const orchestrator = new AgentOrchestrator(slcMock, sleMock, intentRouterMock, assemblerMock, canvasMgr, memoryMock, shadowMock);

        const trace: string[] = [];
        const result = await orchestrator.orchestrate("What is the answer?", () => {}, callId, false, { interrupted: false, slcDone: false }, trace);

        console.log("Trace:", trace);
        console.log("Result:", result);

        if (trace.some(t => t.includes("命中画布知识")) && trace.some(t => t.includes("提取画布内容注入"))) {
            console.log("✅ Knowledge Routing markers found in trace.");
        } else {
            throw new Error("Knowledge Routing markers missing in trace.");
        }

        if (result.includes("The result is 42")) {
            console.log("✅ SLC correctly received canvas summary.");
        } else {
            throw new Error("SLC did not receive the expected canvas summary.");
        }

        // 2. Verify Semantic Renaming
        console.log("\n[Test 2] Testing Semantic Renaming...");
        let capturedSource = "";
        const sleMock2: any = {
            run: async (msg, text, hint, assembler, cid, snap, cm, chunk, sig, source) => {
                capturedSource = source;
                return { output: "Summary" };
            }
        };
        const orchestrator2 = new AgentOrchestrator(slcMock, sleMock2, intentRouterMock, assemblerMock, canvasMgr, memoryMock, shadowMock);
        await orchestrator2.orchestrate("__INTERNAL_TRIGGER__", () => {}, callId, false, { interrupted: false, slcDone: false }, []);
        
        console.log("Captured source for internal trigger:", capturedSource);
        if (capturedSource === 'Async-Result-Delivery') {
            console.log("✅ Semantic renaming confirmed (Async-Result-Delivery).");
        } else {
            throw new Error(`Semantic renaming failed. Expected Async-Result-Delivery but got ${capturedSource}`);
        }

        // 3. Verify Static Lock Check
        console.log("\n[Test 3] Testing Static Lock Check...");
        if (AgentOrchestrator.isLocked(callId)) throw new Error("Should not be locked initially");
        orchestrator.tryLockRefining(callId);
        if (!AgentOrchestrator.isLocked(callId)) throw new Error("Should be locked after tryLockRefining");
        orchestrator.releaseLockRefining(callId);
        if (AgentOrchestrator.isLocked(callId)) throw new Error("Should be unlocked after releaseLockRefining");
        console.log("✅ Static lock check methods confirmed.");

        console.log("\n[V3.6.4 Phase 3] All Tests Passed! 🌟");
    } finally {
        if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    }

    process.exit(0);
}

verify().catch(e => {
    console.error("❌ Verification Failed:", e);
    process.exit(1);
});
