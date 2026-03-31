import { SLEEngine } from '../src/agent/sle';
import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { CanvasManager } from '../src/agent/canvas-manager';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    console.log("=== [V3.6.4 P6: Protocol Consistency & State Persistence Verification Start] ===");

    const workspace = path.join(process.cwd(), "tmp_verify_v364_p6");
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    const config: any = {
        llm: { apiKey: 'dummy', baseUrl: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo' },
        fastAgent: { sleModel: 'gpt-4' }
    };

    const canvasManager = new CanvasManager(workspace);
    const resultSummarizer: any = {};
    const toolResultHandler: any = { handleToolCalls: async () => {} };
    const promptAssembler: any = { assembleSLEPayload: async () => [] };
    const slc: any = { run: async () => "slc_mock_out" };
    const intentRouter: any = { detectIntent: async () => ({ needsTool: false }) };
    const dialogueMemory: any = { getHistoryMessages: async () => [] };
    const shadow: any = { getOrCreateState: () => ({ metadata: {} }), updateState: async () => {} };

    const sle = new SLEEngine(config, resultSummarizer, toolResultHandler);
    const callId = "session_p6_" + Math.random().toString(36).substring(7);

    console.log(`\n1. Verifying SLE Protocol Alignment ('direct_response')...`);

    // Mock OpenAI response
    const mockContent = JSON.stringify({
        thought: "Thinking about the result...",
        direct_response: "Hello, this is a refined summary.",
        status: "COMPLETED",
        importance_score: 5
    });

    (sle as any).openai.chat.completions.create = async () => ({
        choices: [{ message: { content: mockContent } }]
    });

    const sleResult = await sle.run([], "text", "hint", promptAssembler, callId, "{}", canvasManager, () => {}, { interrupted: false, slcDone: false }, "User-Input", "SUMMARIZING");

    console.log("SLE Output (direct_response):", sleResult.output);
    if (sleResult.output === "Hello, this is a refined summary.") {
        console.log("✅ SLE correctly supports 'direct_response' key.");
    } else {
        throw new Error(`❌ SLE failed to extract 'direct_response'. Output: ${sleResult.output}`);
    }

    // Verify legacy 'response' key
    const mockLegacyContent = JSON.stringify({
        response: "Legacy response content."
    });
    (sle as any).openai.chat.completions.create = async () => ({
        choices: [{ message: { content: mockLegacyContent } }]
    });
    const legacyResult = await sle.run([], "text", "hint", promptAssembler, callId, "{}", canvasManager, () => {}, { interrupted: false, slcDone: false }, "User-Input", "SUMMARIZING");
    console.log("SLE Output (legacy response):", legacyResult.output);
    if (legacyResult.output === "Legacy response content.") {
        console.log("✅ SLE correctly supports legacy 'response' key.");
    } else {
        throw new Error(`❌ SLE failed to extract legacy 'response'. Output: ${legacyResult.output}`);
    }

    if (sleResult.parsed && sleResult.parsed.status === "COMPLETED") {
        console.log("✅ SLE correctly returned 'parsed' object.");
    } else {
        throw new Error("❌ SLE failed to return 'parsed' object.");
    }

    console.log(`\n2. Verifying AgentOrchestrator State Distribution (Async-Result-Delivery)...`);

    const orchestrator = new AgentOrchestrator(slc, sle, intentRouter, promptAssembler, canvasManager, dialogueMemory, shadow);
    
    // Track appendCanvasAudit calls
    let auditCalled = false;
    let auditData: any = null;
    let auditStatus: any = null;
    const originalAppend = canvasManager.appendCanvasAudit.bind(canvasManager);
    canvasManager.appendCanvasAudit = async (cid, summary, status) => {
        auditCalled = true;
        auditData = summary;
        auditStatus = status;
        return originalAppend(cid, summary, status);
    };

    // Restore mock with status and score for orchestrator test
    (sle as any).openai.chat.completions.create = async () => ({
        choices: [{ message: { content: mockContent } }]
    });

    await orchestrator.orchestrate("__INTERNAL_TRIGGER__", () => {}, callId, false, { interrupted: false, slcDone: false }, []);

    if (auditCalled) {
        console.log("✅ AgentOrchestrator correctly called appendCanvasAudit during Async-Result-Delivery.");
        console.log("Audit Status:", auditStatus);
        console.log("Audit Importance Score:", auditData.importance_score);
        
        if (auditStatus === "COMPLETED" && auditData.importance_score === 5) {
            console.log("✅ State fields (status, importance_score) correctly passed to CanvasManager.");
        } else {
             throw new Error(`❌ Incorrect audit data. Status: ${auditStatus}, Score: ${auditData.importance_score}`);
        }
    } else {
        throw new Error("❌ AgentOrchestrator failed to trigger appendCanvasAudit!");
    }

    console.log("\n=== [V3.6.4 P6 Verified Successfully] ===");
    
    // Cleanup
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    
    process.exit(0);
}

verify().catch(e => {
    console.error("Verification Failed:", e);
    process.exit(1);
});
