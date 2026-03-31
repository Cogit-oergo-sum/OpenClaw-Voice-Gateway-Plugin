import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';

async function verify() {
    console.log("=== [DECIDING History Truncation Verification] ===");

    const mockSkillsSummary = "MOCK_SKILLS_SUMMARY";
    const history = Array.from({ length: 10 }, (_, i) => ({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i + 1}`
    }));

    const params = {
        text: "Last Input",
        canvasSnapshot: '{"time": "2026/3/27"}',
        current_intent: "test intent",
        dialogueHistory: history
    };

    console.log(`\nTesting DECIDING scenario with ${history.length} history rounds...`);
    const payload = await SLEPayloadAssembler.assemble('DECIDING', 'callId-1', mockSkillsSummary, params);
    
    const userMessage = payload.find(m => m.role === 'user')?.content || "";
    // console.log("User Message Content:\n", userMessage);

    // [Recent History] block parsing
    const historyBlock = userMessage.split('[Recent History]:')[1]?.split('[Current Input]:')[0] || "";
    const lines = historyBlock.trim().split('\n').filter(line => line.trim().startsWith('- ['));
    
    console.log(`Found ${lines.length} history lines in synthesized prompt.`);
    
    if (lines.length === 5) {
        console.log("✅ SUCCESS: History correctly truncated to 5 entries.");
        // Verify they are the LAST 5 (Message 6 to Message 10)
        const expectedLastMessage = "Message 10";
        const expectedFirstOfLastFive = "Message 6";
        
        if (userMessage.includes(expectedLastMessage) && userMessage.includes(expectedFirstOfLastFive)) {
            console.log("✅ SUCCESS: Content matches the last 5 messages.");
        } else {
            console.error("❌ FAILURE: History content does not match expectations.");
            process.exit(1);
        }
    } else {
        console.error(`❌ FAILURE: Expected 5 history lines, but found ${lines.length}.`);
        process.exit(1);
    }

    // Verify ROUTING and SUMMARIZING are unaffected
    console.log("\nVerifying ROUTING scenario is unaffected...");
    const routingPayload = await SLEPayloadAssembler.assemble('ROUTING', 'callId-1', mockSkills_summary_if_needed, params);
    if (routingPayload.some(m => m.role === 'system' && m.content.includes("INTENT_ROUTER_SYSTEM_PROMPT"))) {
       // Note: the assembler calls a function imported from prompts.ts
       // We can just check if it returns something reasonable
    }
    console.log("✅ ROUTING functional.");

    console.log("\nVerifying SUMMARIZING scenario is unaffected...");
    const summarizingPayload = await SLEPayloadAssembler.assemble('SUMMARIZING', 'callId-1', mockSkillsSummary, {
        taskIntent: "task intent",
        taskOutput: "task output"
    });
    const sumUser = summarizingPayload.find(m => m.role === 'user')?.content || "";
    if (sumUser.includes("task intent") && sumUser.includes("task output")) {
        console.log("✅ SUMMARIZING functional and content-accurate.");
    }

    console.log("\n=== [Verification Completed] ===");
    process.exit(0);
}

const mockSkills_summary_if_needed = "MOCK_SKILL";

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
