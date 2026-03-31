import { IntentRouter } from '../src/agent/intent-router';
import { SLEEngine } from '../src/agent/sle';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { CanvasManager } from '../src/agent/canvas-manager';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { PluginConfig } from '../src/types/config';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock OpenAI
class MockOpenAI {
    public lastMessages: any[] = [];
    public chat = {
        completions: {
            create: async (params: any) => {
                this.lastMessages = params.messages;
                if (params.stream) {
                    return (async function* () {
                        yield { choices: [{ delta: { content: 'mock reply' } }] };
                    })();
                }
                return {
                    choices: [{ message: { content: JSON.stringify({ needsTool: false, intent: 'chat' }) } }]
                };
            }
        }
    };
}

async function runTest() {
    console.log("Starting Phase 2 Verification...");

    const tmpDir = path.join(os.tmpdir(), `openclaw_v3.6_p2_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    ['soul.md', 'user.md', 'AGENTS.md', 'IDENTITY.md', 'memory.md'].forEach(f => fs.writeFileSync(path.join(tmpDir, f), `Content of ${f}`));

    const config: PluginConfig = {
        llm: { apiKey: 'test', baseUrl: 'test', model: 'test' }
    } as any;

    const memory = new DialogueMemory(tmpDir);
    const assembler = new PromptAssembler(tmpDir, memory);
    const canvasManager = new CanvasManager(tmpDir);
    const summarizer = new ResultSummarizer(config);
    const toolHandler = new ToolResultHandler(null as any, summarizer, tmpDir);

    const intentRouter = new IntentRouter(config);
    const sleEngine = new SLEEngine(config, summarizer, toolHandler);

    const mockOpenAI = new MockOpenAI();
    (intentRouter as any).openai = mockOpenAI;
    (intentRouter as any).openai.chat = mockOpenAI.chat;
    (sleEngine as any).openai = mockOpenAI;

    const callId = 'test-call';
    const messages = [{ role: 'user', content: 'hello' }];

    console.log("--- Verifying IntentRouter (Scenario A) ---");
    await intentRouter.detectIntent('test input', messages, assembler, callId);
    let routingMsgs = mockOpenAI.lastMessages;
    const routingFullContent = JSON.stringify(routingMsgs);

    // ROUTING should NOT contain ACTION_PROTOCOL or ASR_CORRECTION_PROTOCOL
    if (routingFullContent.includes('行动指令 (Action Protocol)')) {
        throw new Error("ROUTING scenario should NOT include SLE_ACTION_PROTOCOL");
    }
    if (routingFullContent.includes('ASR 专家级纠错指令')) {
        throw new Error("ROUTING scenario should NOT include SLE_ASR_CORRECTION_PROTOCOL");
    }
    console.log("IntentRouter messages verification passed.");

    console.log("--- Verifying SLEEngine (Scenario B) ---");
    const canvasSnapshot = "{}";
    const signal = { interrupted: false, slcDone: false };
    await sleEngine.run(messages, 'test input', 'hint', assembler, callId, canvasSnapshot, canvasManager, () => { }, signal);
    let decidingMsgs = mockOpenAI.lastMessages;
    const decidingFullContent = JSON.stringify(decidingMsgs);

    // Verify DECIDING contains ACTION_PROTOCOL but NOT ASR_CORRECTION_PROTOCOL
    if (!decidingFullContent.includes('行动指令 (Action Protocol)')) {
        throw new Error("DECIDING scenario should include SLE_ACTION_PROTOCOL");
    }
    if (decidingFullContent.includes('ASR 专家级纠错指令')) {
        throw new Error("DECIDING scenario should NOT include SLE_ASR_CORRECTION_PROTOCOL (moved to its own scenario)");
    }
    if (decidingFullContent.includes('fullSoul')) {
        throw new Error("DECIDING should not have fullSoul placeholder");
    }

    console.log("SLEEngine messages verification passed.");


    console.log("All Phase 2 logic tests passed!");
    process.exit(0);
}

runTest().catch(e => {
    console.error("Verification failed:", e);
    process.exit(1);
});
