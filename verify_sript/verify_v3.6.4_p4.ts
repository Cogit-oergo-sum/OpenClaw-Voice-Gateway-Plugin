import { PromptAssembler } from '../src/agent/prompt-assembler';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowManager } from '../src/agent/shadow-manager';
import { buildShadowThought } from '../src/agent/prompts';
import { TextCleaner } from '../src/utils/text-cleaner';
import { SLCEngine } from '../src/agent/slc';
import { callContextStorage } from '../src/context/ctx';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("=== [V3.6.4 Phase 4 Verification Start] ===");

    const workspace = path.join(process.cwd(), "tmp_verify_v3.6.4_p4");
    if (!fs.existsSync(workspace)) fs.mkdirSync(workspace, { recursive: true });

    // Prepare workspace files
    fs.writeFileSync(path.join(workspace, "IDENTITY.md"), "Core Identity Protocol");
    fs.writeFileSync(path.join(workspace, "user.md"), "User Profile Data");
    fs.writeFileSync(path.join(workspace, "soul.md"), "Original Soul Setting");
    fs.writeFileSync(path.join(workspace, "AGENTS.md"), "Agent Guidelines");
    fs.writeFileSync(path.join(workspace, "memory.md"), "Memory logs");

    try {
        const memory = new DialogueMemory(workspace);
        const canvasMgr = new CanvasManager(workspace);
        const shadow = new ShadowManager(workspace);
        const assembler = new PromptAssembler(workspace, memory, canvasMgr);
        const callId = "test_v3_6_4_p4";

        // 1. Verify PromptAssembler slimming
        console.log("\n[Test 1] Testing PromptAssembler Slimming...");
        
        // Case A: No compact persona (should fallback to basic compact version, NOT full MD)
        const stateA = { metadata: {} } as any;
        const promptA = await assembler.assemblePrompt('SLC', callId, stateA);
        if (!promptA.includes("Core Identity Protocol") && !promptA.includes("User Profile Data")) {
            console.log("✅ Case A: Identity and User MD skipped even when compact_persona is missing (Slimmed Fallback).");
        } else {
            throw new Error("Identity or User MD found in Case A - Slimming failed.");
        }

        // Case B: With compact persona
        const stateB = { metadata: { compact_persona: "You are Jarvis." } } as any;
        const promptB = await assembler.assemblePrompt('SLC', callId, stateB);
        if (!promptB.includes("Core Identity Protocol") && !promptB.includes("User Profile Data") && promptB.includes("You are Jarvis.")) {
            console.log("✅ Case B: Identity and User MD skipped and custom snapshot used.");
        } else {
            throw new Error("Case B verification failed.");
        }

        // 2. Verify buildShadowThought types
        console.log("\n[Test 2] Testing buildShadowThought Types...");
        const progress = buildShadowThought('PROGRESS_REPORT', "Searching...");
        const delivery = buildShadowThought('RESULT_DELIVERY', "It is raining.");
        
        console.log("Progress:", progress);
        console.log("Delivery:", delivery);
        
        if (progress.includes("正在执行") && progress.includes("保持其耐心")) {
            console.log("✅ PROGRESS_REPORT wording confirmed.");
        } else {
            throw new Error("PROGRESS_REPORT wording incorrect.");
        }

        if (delivery.includes("已完成") && delivery.includes("正式的回应")) {
            console.log("✅ RESULT_DELIVERY wording confirmed.");
        } else {
            throw new Error("RESULT_DELIVERY wording incorrect.");
        }

        // 3. Verify TextCleaner JSON Removal
        console.log("\n[Test 3] Testing TextCleaner JSON Removal...");
        const dirtyText = "Here is the result: [{\"fact\": \"rain\"}] (done) and JSON: {\"key\": \"val\"}";
        const cleaned = TextCleaner.decant(dirtyText);
        console.log("Cleaned:", cleaned);
        if (!cleaned.includes("{") && !cleaned.includes("[") && cleaned.includes("Here is the result")) {
            console.log("✅ TextCleaner.decant successfully stripped JSON/blocks.");
        } else {
            throw new Error("TextCleaner.decant failed to strip JSON or blocks properly.");
        }

        // 4. Verify SLCEngine Dynamic Type Selection
        console.log("\n[Test 4] Testing SLCEngine Dynamic Type Selection...");
        // Mock slcClient to avoid network calls
        const slc = new SLCEngine({ llm: { apiKey: 'key', baseUrl: 'url' } } as any, assembler, canvasMgr);
        (slc as any).slcClient = {
            chat: {
                completions: {
                    create: async () => ({
                        async *[Symbol.asyncIterator]() {
                            yield { choices: [{ delta: { content: "Hi" } }] };
                        }
                    })
                }
            }
        };

        const canvas = canvasMgr.getCanvas(callId);
        let capturedThought = "";
        const mockOnChunk = (chunk: any) => {
            if (chunk.type === 'thought') capturedThought = chunk.content;
        };

        // Case A: Internal Trigger + PENDING
        canvas.task_status.status = "PENDING";
        await callContextStorage.run({ callId, userId: 'test', startTime: Date.now(), metadata: {} }, async () => {
            await slc.run('__INTERNAL_TRIGGER__', "", "Some Summary", shadow, mockOnChunk, { interrupted: false, slcDone: false });
        });
        console.log("Captured Thought (Pending):", capturedThought);
        if (capturedThought.includes("正在执行")) {
            console.log("✅ SLCEngine correctly chose PROGRESS_REPORT for PENDING status.");
        } else {
            throw new Error("SLCEngine failed to choose PROGRESS_REPORT for PENDING status.");
        }

        // Case B: Internal Trigger + COMPLETED
        canvas.task_status.status = "COMPLETED";
        await callContextStorage.run({ callId, userId: 'test', startTime: Date.now(), metadata: {} }, async () => {
            await slc.run('__INTERNAL_TRIGGER__', "", "Some Summary", shadow, mockOnChunk, { interrupted: false, slcDone: false });
        });
        console.log("Captured Thought (Completed):", capturedThought);
        if (capturedThought.includes("已完成")) {
            console.log("✅ SLCEngine correctly chose RESULT_DELIVERY for COMPLETED status.");
        } else {
            throw new Error("SLCEngine failed to choose RESULT_DELIVERY for COMPLETED status.");
        }

        console.log("\n[V3.6.4 Phase 4] All Tests Passed! 🌟");
    } finally {
        if (fs.existsSync(workspace)) fs.rmSync(workspace, { recursive: true, force: true });
    }

    process.exit(0);
}

verify().catch(e => {
    console.error("❌ Verification Failed:", e);
    process.exit(1);
});
