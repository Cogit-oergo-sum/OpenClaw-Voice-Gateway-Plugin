import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowManager } from '../src/agent/shadow-manager';
import * as fs from 'fs';

async function verify() {
    console.log("=== [Orchestration Flow Verification Start] ===");

    const workspace = "./tmp_verify_orchestrator";
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    const canvasMgr = new CanvasManager(workspace);
    const memory = new DialogueMemory(workspace);
    const shadow = new ShadowManager(workspace);
    
    // Mock dependencies
    const slcMock: any = { 
        run: async () => "slc_output",
        warmUp: async () => {}
    };
    const sleMock: any = { 
        run: async () => ({ output: "sle_output", toolCalls: [], intent: "" })
    };
    const routerMock: any = { 
        detectIntent: async () => ({ needsTool: false, intent: "" })
    };
    const assemblerMock: any = { 
        assemblePrompt: async () => "prompt",
        assembleSLEPayload: async () => []
    };

    const orchestrator = new AgentOrchestrator(
        slcMock, 
        sleMock, 
        routerMock, 
        assemblerMock, 
        canvasMgr, 
        memory, 
        shadow
    );

    const callId = "test_call_123";

    // 1. Verify Refining Lock
    console.log("\n1. Verifying Refining Lock...");
    const lock1 = orchestrator.tryLockRefining(callId);
    console.log("First lock attempt:", lock1);
    const lock2 = orchestrator.tryLockRefining(callId);
    console.log("Second lock attempt (concurrent):", lock2);

    if (lock1 === true && lock2 === false) {
        console.log("✅ Refining lock effectively prevents concurrent execution.");
    } else {
        throw new Error("❌ Refining lock failed!");
    }

    orchestrator.releaseLockRefining(callId);
    const lock3 = orchestrator.tryLockRefining(callId);
    console.log("After release, lock attempt:", lock3);
    if (lock3 === true) {
        console.log("✅ Refining lock release works.");
    } else {
        throw new Error("❌ Refining lock release failed!");
    }
    orchestrator.releaseLockRefining(callId);

    // 2. Verify __INTERNAL_TRIGGER__ flow (Watchdog optimization)
    console.log("\n2. Verifying Watchdog-Heartbeat flow (Routing Optimization)...");
    const trace: string[] = [];
    const canvas = canvasMgr.getCanvas(callId);
    canvas.task_status.summary = "Original result";
    
    await orchestrator.orchestrate("__INTERNAL_TRIGGER__", () => {}, callId, false, { interrupted: false, slcDone: false }, trace);
    
    console.log("Trace for internal trigger:", trace);
    // Should skip '意图分析' (DECIDING) and go straight to '专家结果提纯' (SUMMARIZING)
    const hasIntentAnalysis = trace.some(t => t.includes("意图分析"));
    const hasExpertSync = trace.some(t => t.includes("专家结果提纯"));
    
    if (hasIntentAnalysis) {
        throw new Error("❌ DECIDING phase was NOT skipped for internal trigger!");
    }
    if (hasExpertSync) {
        console.log("✅ DECIDING phase skipped, SUMMARIZING route entered directly.");
    } else {
        throw new Error("❌ Orchestration flow failed to enter SUMMARIZING route!");
    }

    // 3. Verify status machine COMPLETED support
    console.log("\n3. Verifying COMPLETED status support in CanvasManager...");
    await canvasMgr.appendCanvasAudit(callId, "Task done", 'COMPLETED');
    const updatedCanvas = canvasMgr.getCanvas(callId);
    
    console.log("New status:", updatedCanvas.task_status.status);
    if (updatedCanvas.task_status.status === 'COMPLETED') {
        console.log("✅ COMPLETED status is correctly supported.");
    } else {
        throw new Error("❌ COMPLETED status state transition failed!");
    }

    console.log("\n=== [V3.6.2 Orchestration Flow Verified Successfully] ===");
    
    // Cleanup
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    
    process.exit(0);
}

verify().catch(e => {
    console.error("Verification Failed:", e);
    process.exit(1);
});
