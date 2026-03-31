import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CallManager } from '../src/call/call-manager';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DelegateExecutor } from '../src/agent/executor';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import * as path from 'path';

async function verifyZegoAsrMultiple() {
    console.log("=== [ZEGO ASR Correction Multiple Corrections Test] ===");

    const workspaceRoot = path.resolve("./tmp_workspace_zego_multi");
    const callManager = new CallManager({ zego: {}, llm: {}, tts: {} } as any);
    const canvasManager = new CanvasManager(workspaceRoot);
    const executor = {} as DelegateExecutor;
    const summarizer = {} as ResultSummarizer;

    let lastHotwords: any = {};
    (callManager.api as any).updateAgentHotwords = async (hotwords: any) => {
        lastHotwords = hotwords;
    };

    const trh = new ToolResultHandler(executor, summarizer, workspaceRoot, callManager);
    await new Promise(resolve => setTimeout(resolve, 800));

    const userId = "zego-user-multi";
    callManager.createCall(userId);
    const canvas: any = { task_status: { status: 'IDLE' } };

    const toolCall = {
        function: {
            name: 'correct_asr_hotword',
            arguments: JSON.stringify({ wrong: "机构科技", correct: "即构科技" })
        }
    };

    console.log("\nAttempt 1: 机构科技 -> 即构科技");
    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasManager);
    console.log(`Weight: ${lastHotwords["即构科技"]}`);

    console.log("\nAttempt 2: 机构科技 -> 即构科技");
    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasManager);
    console.log(`Weight: ${lastHotwords["即构科技"]}`);

    console.log("\nAttempt 3: 机构科技 -> 即构科技");
    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasManager);
    console.log(`Weight: ${lastHotwords["即构科技"]}`);

    if (lastHotwords["即构科技"] === 11) {
        console.log("\n✅ Adaptive weighting works: 5 -> 8 -> 11.");
    } else {
        console.error(`❌ Weighting mismatch: expected 11, got ${lastHotwords["即构科技"]}`);
    }
}

verifyZegoAsrMultiple().catch(e => {
    console.error(e);
});
