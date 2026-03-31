import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("=== [V3.6.4 P5: Reliability & Lock Cleanup Verification Start] ===");

    const workspace = path.join(process.cwd(), "tmp_verify_v364_p5");
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    const config: any = {
        llm: { apiKey: 'dummy', baseUrl: 'https://api.openai.com/v1' },
        fastAgent: { slcModel: 'qwen-turbo' },
        advanced: { 
            maxResponseTimeMs: 1500,
            fallbackMessage: "让我想想..."
        }
    };

    const agent = new FastAgentV3(config, workspace);
    const callId = "session_p5_" + Math.random().toString(36).substring(7);

    console.log(`\n1. Verifying Universal Session Lock (AgentOrchestrator base for callId: ${callId})...`);

    // Manually lock the session via AgentOrchestrator static access (or instance method)
    const orchestrator = (agent as any).orchestrator;
    const lockedInitially = orchestrator.tryLockSession(callId);
    console.log("Initial manual lock via orchestrator:", lockedInitially);

    if (!lockedInitially) throw new Error("Could not lock session initially");

    console.log("Calling agent.process() while locked...");
    // Mock notify
    const notify = async (text: string) => {};
    
    await agent.process("hello", (chunk) => {}, notify, callId);
    
    // Check if anything was processed. Since it was locked, it should have skipped.
    const history = await (agent as any).dialogueMemory.getHistoryMessages(callId);
    console.log("History length after locked attempt:", history.length);
    if (history.length === 0) {
        console.log("✅ FastAgentV3.process correctly skipped when session was already locked by AgentOrchestrator.");
    } else {
        throw new Error("❌ FastAgentV3 failed to skip locked session!");
    }

    // Release and try again
    orchestrator.releaseLockSession(callId);
    console.log("Released manual lock.");

    // This time it should work. We need to mock SLC/SLE to avoid real LLM calls if possible, 
    // but here we just want to see if it enters the flow.
    // Actually, orchestrate() will attempt real LLM calls if we don't mock.
    // Let's monkey-patch orchestrate to avoid network.
    const originalOrchestrate = orchestrator.orchestrate;
    orchestrator.orchestrate = async () => "mock_result";

    await agent.process("hello again", (chunk) => {}, notify, callId);
    const historyAfter = await (agent as any).dialogueMemory.getHistoryMessages(callId);
    console.log("History length after unlocked attempt:", historyAfter.length);
    if (historyAfter.length > 0) {
        console.log("✅ FastAgentV3.process works correctly when not locked.");
    } else {
        throw new Error("❌ FastAgentV3 failed to process after lock release!");
    }

    // Verify lock was released by process() automatically in finally block
    const isLockedAfter = (AgentOrchestrator as any).sessionLock.has(callId);
    console.log("Is locked after process():", isLockedAfter);
    if (!isLockedAfter) {
        console.log("✅ Lock was correctly released after process() completion.");
    } else {
        throw new Error("❌ Lock not released after process()!");
    }

    console.log("\n2. Verifying SLC Timeout Settings (Static Analysis)...");
    const slcFilePath = path.join(process.cwd(), 'src/agent/slc.ts');
    const slcFile = fs.readFileSync(slcFilePath, 'utf-8');
    if (slcFile.includes('maxResponseTimeMs || 1500')) {
        console.log("✅ SLC timeout default is correctly set to 1500ms.");
    } else {
        throw new Error("❌ SLC timeout default is NOT 1500ms!");
    }

    console.log("\n3. Verifying redundant lockedSessions removal...");
    const fastAgentFile = fs.readFileSync(path.join(process.cwd(), 'src/agent/fast-agent-v3.ts'), 'utf-8');
    if (fastAgentFile.includes('lockedSessions')) {
         throw new Error("❌ redundant 'lockedSessions' still exists in fast-agent-v3.ts!");
    } else {
        console.log("✅ Redundant 'lockedSessions' removed from FastAgentV3.");
    }

    console.log("\n=== [V3.6.4 P5 Verified Successfully] ===");
    
    // Cleanup
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    
    process.exit(0);
}

verify().catch(e => {
    console.error("Verification Failed:", e);
    process.exit(1);
});
