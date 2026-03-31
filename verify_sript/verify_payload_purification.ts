import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';
import { SLE_ACTION_PROTOCOL } from '../src/agent/prompts';

async function verify() {
    console.log("=== [Payload Purification Verification] ===");

    const mockAgentsMd = "SOCIAL_RULES_AGENTS_MD";
    const mockParams = {
        text: "hello",
        canvasSnapshot: '{"time": "2026/3/25"}',
        recentHistorySummary: "history",
        taskIntent: "get weather",
        taskOutput: "it is sunny",
    };

    // 1. Verify ROUTING
    console.log("\n1. Verifying ROUTING scenario...");
    const routingPayload = await SLEPayloadAssembler.assemble('ROUTING', 'call-1', "SKILL_SUMMARY", mockParams);
    const routingUser = routingPayload.find(m => m.role === 'user')?.content || "";
    console.log("ROUTING User Content:", routingUser);
    
    if (routingUser.includes("时间:")) {
        console.warn("⚠️ ROUTING still contains time info (to be removed).");
    } else {
        console.log("✅ ROUTING time info already removed or absent.");
    }

    // 2. Verify DECIDING
    console.log("\n2. Verifying DECIDING scenario...");
    const decidingPayload = await SLEPayloadAssembler.assemble('DECIDING', 'call-1', mockAgentsMd, mockParams);
    const decidingSystem = decidingPayload.find(m => m.role === 'system')?.content || "";
    // console.log("DECIDING System Content:", decidingSystem);
    
    if (decidingSystem.includes(mockAgentsMd)) {
        console.warn("⚠️ DECIDING still contains AGENTS.md injection (to be removed).");
    } else {
        console.log("✅ DECIDING AGENTS.md injection already removed or absent.");
    }

    // 3. Verify SUMMARIZING
    console.log("\n3. Verifying SUMMARIZING scenario...");
    const summarizingPayload = await SLEPayloadAssembler.assemble('SUMMARIZING', 'call-1', mockAgentsMd, mockParams);
    const summarizingUser = summarizingPayload.find(m => m.role === 'user')?.content || "";
    console.log("SUMMARIZING User Content:", summarizingUser);
    
    if (summarizingUser.includes("时间:")) {
        console.warn("⚠️ SUMMARIZING still contains time info (to be removed).");
    }
    if (summarizingUser.includes("[Context]")) {
        console.warn("⚠️ SUMMARIZING still contains [Context] (to be simplified).");
    }
    
    // 4. Verify Action Protocol
    console.log("\n4. Verifying Action Protocol...");
    if (SLE_ACTION_PROTOCOL.includes("逻辑重构") || SLE_ACTION_PROTOCOL.includes("逻辑连贯")) {
        console.log("✅ Action Protocol already updated with intent logic.");
    } else {
        console.warn("⚠️ Action Protocol missing tool parameter logic (to be added).");
    }

    console.log("\n=== [Verification Script Ready] ===");
    process.exit(0);
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
