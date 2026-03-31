import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';
import { buildShadowThought } from '../src/agent/prompts';
import * as fs from 'fs';
import * as path from 'path';

async function verify_v3_6_1_p2() {
    console.log("--- [V3.6.1 Phase 2 Verification: Deduplication & Shadow Thought] ---");

    const agentsMd = "# Agents Policy\n- Test Policy";
    const callId = 'test-call-v361-p2';

    // Case 1: Deduplication test
    console.log("\n[1] Testing Logic Deduplication...");
    const text = "我想喝咖啡";
    const historyWithSameUser = [
        { role: 'user', content: '我想喝咖啡' }
    ];

    const payload1 = await SLEPayloadAssembler.assemble('DECIDING', callId, agentsMd, {
        text,
        dialogueHistory: historyWithSameUser,
        canvasSnapshot: '{}',
        intentHint: '无'
    });

    const userMessages = payload1.filter(m => m.role === 'user');
    // Expected: 
    // 1. Snapshot + History (merged into one user message)

    console.log("- User messages count:", userMessages.length);
    userMessages.forEach((m, i) => console.log(`  ${i}: [${m.role}] ${m.content}`));

    // [V3.6.1] Fix: Now Snapshot and History are merged to avoid consecutive user roles.
    if (userMessages.length !== 1) {
        console.error(`FAIL: Expected 1 merged user message, but got ${userMessages.length}`);
        process.exit(1);
    }

    // Case 2: Assistant Pre-fill test
    console.log("\n[2] Testing Assistant Pre-fill (Shadow Thought)...");
    const intentHint = "帮用户点一杯咖啡";
    const payload2 = await SLEPayloadAssembler.assemble('DECIDING', callId, agentsMd, {
        text,
        dialogueHistory: [],
        canvasSnapshot: '{}',
        intentHint
    });

    const lastMsg = payload2[payload2.length - 1];
    console.log("- Last message:", JSON.stringify(lastMsg));

    const expectedShadow = buildShadowThought('waiting', intentHint);
    if (lastMsg.role !== 'assistant' || lastMsg.content !== expectedShadow) {
        console.error(`FAIL: Last message should be assistant with shadow thought.`);
        console.error(`Expected: assistant | ${expectedShadow}`);
        console.error(`Got: ${lastMsg.role} | ${lastMsg.content}`);
        process.exit(1);
    }
    console.log("- Shadow Thought match: OK");

    // Case 3: Internal Trigger test
    console.log("\n[3] Testing Internal Trigger Mapping...");
    const payload3 = await SLEPayloadAssembler.assemble('DECIDING', callId, agentsMd, {
        text: '__INTERNAL_TRIGGER__',
        dialogueHistory: [],
        canvasSnapshot: '{}',
        intentHint: '后台任务已完成'
    });
    const lastMsg3 = payload3[payload3.length - 1];
    const expectedShadow3 = buildShadowThought('internal', '后台任务已完成');
    if (lastMsg3.role !== 'assistant' || lastMsg3.content !== expectedShadow3) {
        console.error("FAIL: Internal trigger shadow thought mismatch");
        process.exit(1);
    }
    console.log("- Internal Trigger Shadow match: OK");

    console.log("\n--- [VERIFICATION SUCCESSFUL] ---");
    process.exit(0);
}

verify_v3_6_1_p2().catch(e => {
    console.error(e);
    process.exit(1);
});
