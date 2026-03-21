import { DialogueMemory } from '../src/agent/dialogue-memory';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    const workspaceRoot = path.resolve(__dirname, '../tmp/workspace_test_s5');
    if (!fs.existsSync(workspaceRoot)) {
        fs.mkdirSync(workspaceRoot, { recursive: true });
    }

    const memory = new DialogueMemory(workspaceRoot);
    const callId = 'test-call-' + Date.now();

    console.log('--- 1. Testing logDialogue ---');
    await memory.logDialogue(callId, 'user', 'Hello, this is a (thinking) test message.');
    await memory.logDialogue(callId, 'assistant', 'Hello! How [loading...] can I help you today?');
    console.log('Messages logged.');

    console.log('\n--- 2. Testing getHistoryMessages (with Decant) ---');
    const messages = await memory.getHistoryMessages(callId, 5);
    console.log('Retrieved messages:', JSON.stringify(messages, null, 2));

    // Decant should remove (thinking) and [loading...]
    if (messages.length === 2 && 
        messages[0].role === 'user' && 
        messages[0].content.replace(/\s+/g, ' ') === 'Hello, this is a test message.' &&
        messages[1].role === 'assistant' &&
        messages[1].content.replace(/\s+/g, ' ') === 'Hello! How can I help you today?') {
        console.log('✅ getHistoryMessages verification PASSED.');
    } else {
        console.error('❌ getHistoryMessages verification FAILED.');
        process.exit(1);
    }

    console.log('\n--- 3. Testing getRecentDialogueContextRaw ---');
    const rawContext = await memory.getRecentDialogueContextRaw(5, callId);
    console.log('Raw context:\n', rawContext);
    if (rawContext.includes('用户: Hello') && rawContext.includes('助理: Hello')) {
        console.log('✅ getRecentDialogueContextRaw verification PASSED.');
    } else {
        console.error('❌ getRecentDialogueContextRaw verification FAILED.');
        process.exit(1);
    }

    console.log('\n--- 4. Testing getRecentDialogueContext ---');
    const summary = await memory.getRecentDialogueContext(callId, 'session_start', 'task-123', 2);
    console.log('Summary context:', summary);
    if (summary.includes('用户: Hello') && summary.includes('助理: Hello') && summary.includes('当前状态: session_start') && summary.includes('任务ID: task-123')) {
        console.log('✅ getRecentDialogueContext verification PASSED.');
    } else {
        console.error('❌ getRecentDialogueContext verification FAILED.');
        process.exit(1);
    }

    console.log('\n🎉 ALL S5 DialogueMemory tests PASSED.');

    // Cleanup
    // fs.rmSync(workspaceRoot, { recursive: true, force: true });
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
