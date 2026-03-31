import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function runTest() {
    const tmpDir = path.join(os.tmpdir(), `openclaw_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    try {
        // Create required files for PromptAssembler
        const files = ['soul.md', 'user.md', 'AGENTS.md', 'IDENTITY.md', 'memory.md'];
        files.forEach(f => fs.writeFileSync(path.join(tmpDir, f), `Content of ${f}`));

        const memory = new DialogueMemory(tmpDir);
        // Mock some history
        await memory.logDialogue('test-call', 'user', 'Hello');
        await memory.logDialogue('test-call', 'assistant', 'Hi there');
        await memory.logDialogue('test-call', 'user', 'How is the weather?');

        const assembler = new PromptAssembler(tmpDir, memory);

        console.log("--- Testing Scenario ROUTING ---");
        const routing = await assembler.assembleSLEPayload('ROUTING', 'test-call', { text: 'What is the weather in Shanghai?' });
        if (routing.length !== 3) throw new Error("ROUTING should have 3 messages");
        if (routing[0].role !== 'system') throw new Error("First message should be system");
        if (routing[1].role !== 'user') throw new Error("Second message should be user (context)");
        if (routing[2].role !== 'user') throw new Error("Third message should be user (text)");
        if (!routing[0].content.includes('Content of AGENTS.md')) throw new Error("System prompt should contain skills summary");
        // DialogueMemory.getRecentDialogueContextRaw(3) returns "用户: Hello\n助理: Hi there\n用户: How is the weather?"
        if (!routing[1].content.includes('用户: Hello\n助理: Hi there\n用户: How is the weather?')) throw new Error("Context should contain history summary");
        console.log("ROUTING OK");

        console.log("--- Testing Scenario DECIDING ---");
        const deciding = await assembler.assembleSLEPayload('DECIDING', 'test-call', {
            text: '北京呢？',
            intentHint: '查询上海天气',
            canvasSnapshot: '{"temp": "20C"}',
            dialogueHistory: [{ role: 'user', content: '上海天气' }, { role: 'assistant', content: '上海晴天' }]
        });
        if (deciding.length !== 5) throw new Error("DECIDING should have 5 messages (system + context + 2 history + latest text)");
        if (deciding[0].role !== 'system') throw new Error("System prompt role mismatch");
        if (deciding[1].role !== 'user') throw new Error("Context role mismatch");
        if (!deciding[1].content.includes('查询上海天气')) throw new Error("Intent hint missing in Deciding context");
        if (!deciding[0].content.includes('Content of AGENTS.md')) throw new Error("System prompt missing agents schema");
        console.log("DECIDING OK");

        console.log("--- Testing Scenario REFINING ---");
        const refining = await assembler.assembleSLEPayload('REFINING', 'test-call', { fullPersonaContext: 'Persona data' });
        if (refining.length !== 2) throw new Error("REFINING should have 2 messages");
        if (refining[0].role !== 'system') throw new Error("REFINING system role error");
        if (refining[1].content !== 'Persona data') throw new Error("REFINING content error");
        console.log("REFINING OK");

        console.log("--- Testing Scenario SUMMARIZING ---");
        const summarizing = await assembler.assembleSLEPayload('SUMMARIZING', 'test-call', {
            taskIntent: 'Weather',
            taskOutput: 'Sunny 25C'
        });
        if (summarizing.length !== 2) throw new Error("SUMMARIZING should have 2 messages");
        if (!summarizing[1].content.includes('Weather') || !summarizing[1].content.includes('Sunny 25C')) throw new Error("SUMMARIZING content mismatch");
        console.log("SUMMARIZING OK");

        console.log("--- Testing Scenario ASR_CORRECTION ---");
        const asr = await assembler.assembleSLEPayload('ASR_CORRECTION', 'test-call', { text: '我要去上海的天起' });
        if (asr.length !== 2) throw new Error("ASR_CORRECTION should have 2 messages");
        if (!asr[1].content.includes('我要去上海的天起')) throw new Error("ASR content missing user voice");
        if (!asr[1].content.includes('Hello')) throw new Error("ASR content missing background history");
        console.log("ASR_CORRECTION OK");

        console.log("--- Testing Backward Compatibility (SLC) ---");
        const slc = await assembler.assemblePrompt('SLC', 'test-call', {
            mode: 'chat',
            task_id: '',
            progress: '',
            metadata: { compact_persona: 'Custom Persona' },
            lastUpdated: Date.now()
        });
        if (!slc.includes('Custom Persona')) throw new Error("SLC assembly should work as before");
        console.log("SLC OK");

        console.log("All tests passed!");
        process.exit(0);
    } finally {
        // Clean up
        // fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

runTest().catch(e => {
    console.error("Test failed:", e.message);
    process.exit(1);
});
