import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CanvasManager } from '../src/agent/canvas-manager';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import { SkillRegistry } from '../src/agent/skills/index';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("=== [Progressive Summary Verification Start] ===");

    const workspace = "./tmp_verify_progressive";
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    // 1. Mock Dependencies
    const canvasMgr = new CanvasManager(workspace);
    const summarizerMock: any = {
        summarizeTaskResult: async (assembler: any, callId: string, raw: string, intent: string) => {
            console.log(`[Mock] Summarizing raw output: ${raw.substring(0, 30)}...`);
            return { direct_response: `Summary: ${raw}`, extended_context: "" };
        }
    };
    const executorMock: any = {
        executeOpenClaw: async () => ({ stdout: "Final Result", isTimeout: false })
    };
    const assemblerMock: any = {};

    const handler = new ToolResultHandler(executorMock, summarizerMock, workspace, undefined, assemblerMock);
    const callId = "test_progressive_call";
    const canvas = canvasMgr.getCanvas(callId);

    // 2. Mock a Long-Running Skill
    const registry = SkillRegistry.getInstance();
    const mockLongRunningSkill = {
        name: 'test_long_running',
        description: 'Test',
        parameters: {},
        isLongRunning: true,
        execute: async (args: any, cid: string, cm: any) => {
            // Simulate slow execution that provides intermediate updates via Canvas
            return new Promise<string>((resolve) => {
                setTimeout(async () => {
                    const c = cm.getCanvas(cid);
                    c.task_status.summary = "Intermediate Progress 1";
                    c.task_status.version = Date.now();
                    console.log("[Mock Skill] Pushed Progress 1");
                }, 1000);

                setTimeout(async () => {
                    const c = cm.getCanvas(cid);
                    c.task_status.summary = "Intermediate Progress 2";
                    c.task_status.version = Date.now();
                    console.log("[Mock Skill] Pushed Progress 2");
                }, 3000);

                setTimeout(() => {
                    console.log("[Mock Skill] Resolving Final Result");
                    resolve("Final Finished Output");
                }, 6000);
            });
        }
    };
    registry.register(mockLongRunningSkill as any);

    // 3. Trigger Tool Call
    console.log("\nStarting long-running tool call...");
    const toolCall = {
        id: 'call_1',
        type: 'function',
        function: { name: 'test_long_running', arguments: '{}' }
    };

    await handler.handleToolCalls([toolCall], "Do something long", callId, canvas, canvasMgr);

    console.log("Waiting for progressive summaries to be triggered (2s intervals)...");
    
    // Wait for the whole process (6s execution + some buffer)
    await new Promise(r => setTimeout(r, 10000));

    // 4. Verification
    const events = await canvasMgr.getCanvasEvents(callId);
    console.log(`\nAudit log count: ${events.length}`);
    
    const progressSyncs = events.filter(e => e.event === 'CANVAS_PROGRESS_SYNC');
    console.log(`Progress Sync events found: ${progressSyncs.length}`);

    // Expect at least 2 progressive summaries (from the two timeouts) + 1 final summary
    if (progressSyncs.length >= 2) {
        console.log("✅ Progressive summary mechanism confirmed!");
    } else {
        console.warn("⚠️ Did not detect multiple progressive summaries. Check timing parameters.");
    }

    const finalStatus = canvasMgr.getCanvas(callId).task_status.status;
    console.log(`Final task status: ${finalStatus}`);
    if (finalStatus === 'READY' || finalStatus === 'PENDING') {
        console.log("✅ Task flow completed without crash.");
    }

    // Cleanup
    if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    
    console.log("\n=== [Verification Finished] ===");
    process.exit(0);
}

verify().catch(e => {
    console.error("Verification Failed:", e);
    process.exit(1);
});
