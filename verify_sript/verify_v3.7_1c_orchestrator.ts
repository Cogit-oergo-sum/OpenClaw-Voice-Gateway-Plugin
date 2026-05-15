import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { SLCEngine } from '../src/agent/slc';
import { SLEEngine } from '../src/agent/sle';
import { IntentRouter } from '../src/agent/intent-router';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowManager } from '../src/agent/shadow-manager';
import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { RouterResult } from '../src/agent/types';

async function verifyOrchestrator() {
    console.log("🚀 Starting Agent 1C Orchestrator Verification...");
    
    const callId = "test_call_1c";
    const workspaceRoot = process.cwd();
    
    // Mocks
    const slc = { run: async () => "SLC Response" } as any;
    const sle = { run: async () => ({ output: "SLE Output", toolCalls: [], intent: "test" }) } as any;
    const router = { detectIntent: async () => ({}) } as any;
    const prompt = {} as any;
    const canvasManager = new CanvasManager(workspaceRoot);
    const memory = { getHistoryMessages: async () => [] } as any;
    const shadow = {} as any;
    const toolHandler = { abortTask: (id: string) => { console.log(`Mock Abort: ${id}`); return true; } } as any;
    const cronManager = {} as any;
    const executor = { deleteAgent: async () => true } as any;

    const orchestrator = new AgentOrchestrator(slc, sle, router, prompt, canvasManager, memory, shadow, toolHandler, cronManager, executor);

    // 1. Mock Router returning 2 NEW_TASK intents
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [
            { intent_id: "i1", type: "NEW_TASK", task_name: "Task A", query: "Do A" },
            { intent_id: "i2", type: "NEW_TASK", task_name: "Task B", query: "Do B" }
        ],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });

    console.log("\n--- Test 1: NEW_TASK Concurrent Distribution ---");
    const trace1: string[] = [];
    await orchestrator.orchestrate("Start A and B", () => {}, callId, true, { interrupted: false, slcDone: false }, trace1);
    
    const canvas = canvasManager.getCanvas(callId);
    console.log(`Canvas Tasks Length: ${canvas.tasks.length} (Expected >= 2)`);
    canvas.tasks.forEach(t => console.log(`Task: ${t.name}, Status: ${t.status}, ID: ${t.id}`));
    
    if (canvas.tasks.length < 2) throw new Error("Tasks not created in canvas");

    // 2. Mock Router returning CANCEL_TASK
    const taskIdToCancel = canvas.tasks[0].id;
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [{ intent_id: "i3", type: "CANCEL_TASK", target_task_id: taskIdToCancel }],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });

    console.log("\n--- Test 2: CANCEL_TASK ---");
    const trace2: string[] = [];
    await orchestrator.orchestrate("Cancel first task", () => {}, callId, false, { interrupted: false, slcDone: false }, trace2);
    
    const cancelledTask = canvasManager.getTask(callId, taskIdToCancel);
    console.log(`Task ${taskIdToCancel} Status: ${cancelledTask?.status} (Expected CANCELLED)`);
    if (cancelledTask?.status !== 'CANCELLED') throw new Error("Task was not cancelled");

    // 3. Mock Router returning Mixed Intents + Matched Task
    const taskIdToMatch = canvas.tasks[1].id;
    canvasManager.updateTask(callId, taskIdToMatch, { summary: "Result of Task B", status: 'READY' });
    
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [{ intent_id: "i4", type: "NEW_TASK", task_name: "Task C", query: "Do C" }],
        isAnswerInActiveCanvas: true,
        isAnswerInArchiveMemory: false,
        matched_task_ids: [taskIdToMatch]
    });

    console.log("\n--- Test 3: Mixed Intents + Matched Task ---");
    let slcContextCaptured = "";
    const mockSlc = { 
        run: async (text: string, fragment: string, context: string) => {
            slcContextCaptured = context;
            return "SLC Response";
        }
    } as any;
    (orchestrator as any).slc = mockSlc;

    await orchestrator.orchestrate("Do C and what about B?", () => {}, callId, false, { interrupted: false, slcDone: false }, []);
    console.log(`Captured SLC Context: ${slcContextCaptured}`);
    if (!slcContextCaptured.includes("Task B") || !slcContextCaptured.includes("Task C")) {
        throw new Error("SLC Context should include both 'Task B' and 'Task C'");
    }

    // 4. CLARIFY Test
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [{ intent_id: "i5", type: "CLARIFY", message: "Which folder do you mean?" }],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });
    console.log("\n--- Test 4: CLARIFY ---");
    let clarifyOutput = "";
    const resp = await orchestrator.orchestrate("Move things", (chunk) => { clarifyOutput = chunk.content; }, callId, false, { interrupted: false, slcDone: false }, []);
    console.log(`Clarify Output: ${resp} (Expected "Which folder do you mean?")`);
    if (resp !== "Which folder do you mean?") throw new Error("Clarify failed");

    console.log("\n✅ All Orchestrator Verification passed!");
    process.exit(0);
}

verifyOrchestrator().catch(e => {
    console.error("❌ Verification failed:", e);
    process.exit(1);
});
