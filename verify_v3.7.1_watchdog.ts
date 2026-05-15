import { WatchdogService } from './src/agent/watchdog';
import { CanvasManager } from './src/agent/canvas-manager';
import { AgentOrchestrator } from './src/agent/agent-orchestrator';
import { ShadowManager } from './src/agent/shadow-manager';
import { DialogueMemory } from './src/agent/dialogue-memory';
import { TaskItem, CanvasState } from './src/agent/types';
import * as fs from 'fs';
import * as path from 'path';

async function verifyWatchdogAndPersona() {
    console.log("🚀 Starting V3.7.1 Watchdog & Persona Verification...");
    const workspaceRoot = process.cwd();
    const callId = "test_v371_call";
    
    // Cleanup old logs
    if (fs.existsSync(path.join(workspaceRoot, 'logs/canvas_snapshot.json'))) {
        fs.unlinkSync(path.join(workspaceRoot, 'logs/canvas_snapshot.json'));
    }

    // --- 1. Verify Watchdog Atomic Delivery ---
    console.log("\n--- Test 1: Watchdog Atomic Delivery ---");
    const canvasManager = new CanvasManager(workspaceRoot);
    const memory = { logEvent: async () => {} } as any;
    const watchdog = new WatchdogService(canvasManager, memory, "test-instance", 100);
    
    const canvas = canvasManager.getCanvas(callId);
    const taskId = canvasManager.createTask(callId, "Test Task");
    canvasManager.updateTask(callId, taskId, { status: 'READY', summary: "Task is ready", importance_score: 10 });
    
    let emitTriggered = false;
    let isDeliveredBeforeEmit = false;
    let persistCount = 0;

    // Spy on persistContext
    const originalPersist = canvasManager.persistContext.bind(canvasManager);
    canvasManager.persistContext = async (id: string) => {
        persistCount++;
        return originalPersist(id);
    };

    watchdog.on('trigger', (data) => {
        emitTriggered = true;
        const task = data.tasks.find((t: any) => t.id === taskId);
        isDeliveredBeforeEmit = task.is_delivered;
        console.log(`[Watchdog Event] Task ${taskId} is_delivered in emit: ${isDeliveredBeforeEmit}`);
    });

    // Register a mock notifier so watchdog triggers
    watchdog.registerNotifier(callId, async () => {});

    // Run one tick of watchdog manually or wait for timer
    watchdog.start();
    
    // Wait for watchdog to trigger
    const start = Date.now();
    while (!emitTriggered && Date.now() - start < 2000) {
        await new Promise(r => setTimeout(r, 100));
    }
    watchdog.stop();

    if (!emitTriggered) throw new Error("Watchdog trigger was not emitted");
    if (!isDeliveredBeforeEmit) throw new Error("Task was NOT marked as delivered before emit!");
    if (persistCount === 0) throw new Error("Canvas context was NOT persisted before emit!");
    console.log("✅ Watchdog Atomic Delivery verified.");

    // --- 2. Verify Orchestrator Persona Refresh ---
    console.log("\n--- Test 2: Orchestrator Persona Refresh ---");
    const slc = { run: async () => "SLC Response" } as any;
    
    let refiningTriggered = false;
    const sle = { 
        run: async (history: any, text: string, name: string, assembler: any, id: string, snapshot: any, mgr: any, onChunk: any, signal: any, source: any, scenario: any) => {
            if (scenario === 'REFINING') {
                refiningTriggered = true;
                return { parsed: { compact_persona: "New Compact Persona" }, output: "Refined" };
            }
            return { output: "SLE Output" };
        }
    } as any;
    
    const router = { detectIntent: async () => ({ intents: [], matched_task_ids: [] }) } as any;
    const prompt = { assemblePrompt: async () => "Prompt" } as any;
    const shadow = new ShadowManager(workspaceRoot);
    const mockMemory = { 
        logEvent: async () => {},
        getHistoryMessages: async () => []
    } as any;
    const toolHandler = { abortTask: () => {} } as any;
    
    const orchestrator = new AgentOrchestrator(slc, sle, router, prompt, canvasManager, mockMemory, shadow, toolHandler, {} as any, { deleteAgent: async () => true } as any);
    
    // Initial state: no compact_persona
    const state = shadow.getOrCreateState(callId);
    console.log(`Initial compact_persona: ${state.metadata.compact_persona || 'none'}`);

    console.log("Triggering orchestrate (isNewSession=true)...");
    await orchestrator.orchestrate("Hello", () => {}, callId, true, { interrupted: false, slcDone: false }, []);
    
    // Wait for async refreshPersona
    await new Promise(r => setTimeout(r, 500));
    
    if (!refiningTriggered) throw new Error("REFINING scenario was not triggered!");
    
    const updatedState = shadow.getOrCreateState(callId);
    console.log(`Updated compact_persona: ${updatedState.metadata.compact_persona}`);
    if (updatedState.metadata.compact_persona !== "New Compact Persona") {
        throw new Error("Compact persona was not updated in shadow state!");
    }
    console.log("✅ Orchestrator Persona Refresh verified.");

    console.log("\n🎉 All V3.7.1 Stage 2 Verifications passed!");
    process.exit(0);
}

verifyWatchdogAndPersona().catch(e => {
    console.error("❌ Verification failed:", e);
    process.exit(1);
});
