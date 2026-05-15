import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { CanvasManager } from '../src/agent/canvas-manager';
import { RouterResult } from '../src/agent/types';

async function verifyDependsOn() {
    console.log("🚀 Starting Agent 4A Task Dependency Verification...");
    const callId = "test_call_4a";
    const workspaceRoot = process.cwd();

    // 1. Mocks
    const slc = { 
        run: async () => "SLC Filler" 
    } as any;
    
    let sleRunCount = 0;
    let capturedQueries: string[] = [];
    let capturedSnapshots: string[] = [];
    
    const sle = { 
        run: async (history, text, query, prompt, callId, snapshot, manager, onChunk, signal, source, scenario, taskId) => {
            sleRunCount++;
            capturedQueries.push(query);
            capturedSnapshots.push(snapshot);
            console.log(`[Mock SLE] Task ${taskId} started with query: ${query.substring(0, 50)}...`);
            return { output: "Task Done", status: 'COMPLETED' };
        } 
    } as any;

    const router = { detectIntent: async () => ({ intents: [] }) } as any;
    const prompt = { assembleSLEPayload: () => ({}) } as any;
    const canvasManager = new CanvasManager(workspaceRoot);
    const memory = { getHistoryMessages: async () => [] } as any;
    const shadow = { buildShadowThought: () => "" } as any;
    const toolHandler = { abortTask: (id: string) => { console.log(`Mock Abort: ${id}`); } } as any;
    const cronManager = {} as any;
    const executor = { deleteAgent: async () => true } as any;

    const orchestrator = new AgentOrchestrator(slc, sle, router, prompt, canvasManager, memory, shadow, toolHandler as any, cronManager, executor);

    // --- Case 1: Standard Chain A -> B ---
    console.log("\n--- Test 1: Standard Chain A -> B (Success) ---");
    sleRunCount = 0;
    capturedQueries = [];
    capturedSnapshots = [];
    
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [
            { intent_id: "req_1", type: "NEW_TASK", task_name: "Read File", query: "read report.txt" },
            { intent_id: "req_2", type: "NEW_TASK", task_name: "Send Email", query: "send mail", depends_on: "req_1" }
        ],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });

    await orchestrator.orchestrate("Read and send", () => {}, callId, true, { interrupted: false, slcDone: false }, []);
    
    let canvas = canvasManager.getCanvas(callId);
    let taskA = canvas.tasks.find(t => t.name === "Read File")!;
    let taskB = canvas.tasks.find(t => t.name === "Send Email")!;

    console.log(`Task A ID: ${taskA.id}, Status: ${taskA.status}`);
    console.log(`Task B ID: ${taskB.id}, Status: ${taskB.status} (Expected PENDING)`);
    
    if ((sleRunCount as number) !== 1) throw new Error(`Expected 1 immediate SLE run, got ${sleRunCount}`);

    // 模拟 Task A 完成
    console.log("Simulating Task A completion...");
    canvasManager.updateTask(callId, taskA.id, { status: 'COMPLETED', summary: "Content of report.txt: Hello World" });

    // 等待轮询 (watchAndRunTask 每 500ms 检查一次)
    console.log("Waiting for observer to trigger Task B...");
    await new Promise(resolve => setTimeout(resolve, 1200));

    console.log(`SLE Run Count: ${sleRunCount} (Expected 2)`);
    if ((sleRunCount as number) !== 2) throw new Error(`Task B did not start. sleRunCount = ${sleRunCount}`);
    
    console.log(`Captured Query for B: ${capturedQueries[1]}`);
    if (!capturedQueries[1].includes("Hello World")) throw new Error("Task B did not receive context from A in query");

    const snapshotB = JSON.parse(capturedSnapshots[1]);
    console.log(`Snapshot B Tasks Count: ${snapshotB.tasks.length} (Expected 2)`);
    if (snapshotB.tasks.length !== 2) throw new Error("Snapshot for Task B should include predecessor");

    // --- Case 2: Failure Chain A (FAILED) -> B (CANCELLED) ---
    console.log("\n--- Test 2: Failure Propagation A -> B ---");
    const callId2 = "test_call_4a_fail";
    let slcMsg = "";
    
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [
            { intent_id: "f1", type: "NEW_TASK", task_name: "Task A", query: "do a" },
            { intent_id: "f2", type: "NEW_TASK", task_name: "Task B", query: "do b", depends_on: "f1" }
        ],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });

    await orchestrator.orchestrate("Fail chain", (chunk) => { if (chunk.type === 'chat') slcMsg = chunk.content; }, callId2, true, { interrupted: false, slcDone: false }, []);
    
    const tasks2 = canvasManager.getCanvas(callId2).tasks;
    const taskA2 = tasks2.find(t => t.name === "Task A")!;
    const taskB2 = tasks2.find(t => t.name === "Task B")!;

    console.log("Simulating Task A failure...");
    canvasManager.updateTask(callId2, taskA2.id, { status: 'FAILED', summary: "Internal error" });

    await new Promise(resolve => setTimeout(resolve, 800));

    const updatedTaskB2 = canvasManager.getTask(callId2, taskB2.id);
    console.log(`Task B2 Status: ${updatedTaskB2?.status} (Expected CANCELLED)`);
    console.log(`SLC Notification: ${slcMsg}`);

    if (updatedTaskB2?.status !== 'CANCELLED') throw new Error("Task B was not cancelled on predecessor failure");
    if (!slcMsg.includes("已取消")) throw new Error("SLC did not notify about cancellation");

    // --- Case 3: Three-level Chain A -> B -> C ---
    console.log("\n--- Test 3: Three-level Chain A -> B -> C ---");
    const callId3 = "test_call_4a_triple";
    sleRunCount = 0;
    
    router.detectIntent = async (): Promise<RouterResult> => ({
        intents: [
            { intent_id: "a1", type: "NEW_TASK", task_name: "A", query: "q a" },
            { intent_id: "a2", type: "NEW_TASK", task_name: "B", query: "q b", depends_on: "a1" },
            { intent_id: "a3", type: "NEW_TASK", task_name: "C", query: "q c", depends_on: "a2" }
        ],
        isAnswerInActiveCanvas: false,
        isAnswerInArchiveMemory: false,
        matched_task_ids: []
    });

    await orchestrator.orchestrate("Triple chain", () => {}, callId3, true, { interrupted: false, slcDone: false }, []);
    
    const tasks3 = canvasManager.getCanvas(callId3).tasks;
    const tA = tasks3.find(t => t.name === "A")!;
    const tB = tasks3.find(t => t.name === "B")!;
    const tC = tasks3.find(t => t.name === "C")!;

    console.log("A is running, B and C pending...");
    canvasManager.updateTask(callId3, tA.id, { status: 'COMPLETED', summary: "A result" });
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`After A done, B run count: ${sleRunCount} (Expected 2, A and B)`);
    
    canvasManager.updateTask(callId3, tB.id, { status: 'COMPLETED', summary: "B result" });
    await new Promise(resolve => setTimeout(resolve, 800));
    console.log(`After B done, C run count: ${sleRunCount} (Expected 3, A, B and C)`);

    if ((sleRunCount as number) !== 3) throw new Error("Triple chain failed to execute in sequence");

    console.log("\n✅ Agent 4A Dependencies Verification PASSED!");
    process.exit(0);
}

verifyDependsOn().catch(e => {
    console.error("❌ Verification FAILED:", e);
    console.error(e.stack);
    process.exit(1);
});
