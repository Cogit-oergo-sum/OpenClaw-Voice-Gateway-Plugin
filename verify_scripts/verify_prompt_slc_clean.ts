
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { CanvasManager } from '../src/agent/canvas-manager';
import * as fs from 'fs';
import * as path from 'path';

async function runTest() {
    const workspaceRoot = path.join(process.cwd(), 'mock_workspace_v36');
    if (!fs.existsSync(workspaceRoot)) {
        fs.mkdirSync(workspaceRoot, { recursive: true });
    }
    
    // Prepare mock files
    fs.writeFileSync(path.join(workspaceRoot, 'soul.md'), '# Jarvis Soul\n你是智慧管家。风格: 幽默风趣。语感: 亲切。');
    fs.writeFileSync(path.join(workspaceRoot, 'user.md'), '姓名: Rhettbot');
    fs.writeFileSync(path.join(workspaceRoot, 'IDENTITY.md'), 'Identity Data');
    fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'Agent Rules');
    fs.writeFileSync(path.join(workspaceRoot, 'memory.md'), 'Memory Data');

    const memory = {
        getRecentDialogueContextRaw: async () => 'User: Hello\nAssistant: Hi'
    } as any;
    const canvasManager = {
        getCanvas: () => ({ env: { time: '2024-01-01 12:00:00' } })
    } as any;

    const assembler = new PromptAssembler(workspaceRoot, memory, canvasManager);
    
    console.log('--- Testing getCompactPersona ---');
    const compact = await assembler.getCompactPersona();
    console.log('Result:', compact);
    if (compact.includes('Jarvis') && compact.includes('Rhettbot') && (compact.includes('幽默风趣') || compact.includes('亲切'))) {
        console.log('✅ Name and Style extraction passed.');
    } else {
        console.log('❌ Extraction failed.');
    }

    console.log('\n--- Testing assemblePrompt (Cleaning) ---');
    const state = {
        metadata: {
            compact_persona: '[ Jarvis 核心人设快照 ]\n你是特别的人设。'
        }
    } as any;
    
    const prompt = await assembler.assemblePrompt('SLC', 'call-1', state);
    console.log('Prompt Output:\n', prompt);
    
    if (prompt.includes('[ Jarvis 核心人设快照 ]')) {
        console.log('❌ Failed to remove label.');
    } else if (prompt.includes('锚点')) {
        console.log('❌ Found "锚点", should be removed.');
    } else if (prompt.includes('本地时间:')) {
        console.log('✅ Label cleaning and environment injection passed.');
    } else {
        console.log('❌ Unexpected output.');
    }

    console.log('\n--- Testing getContextPrompts ---');
    const ctxPrompt = await assembler.getContextPrompts('call-1', state);
    if (ctxPrompt.includes('Identity Data')) {
        console.log('✅ IDENTITY.md included in context.');
    } else {
        console.log('❌ IDENTITY.md missing from context.');
    }
}

runTest().catch(console.error);
