import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowState } from '../src/agent/shadow-manager';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
    const workspaceRoot = path.join(process.cwd(), '../openclaw-test-env/workspace');
    
    // Ensure workspaceRoot exists for the test
    if (!fs.existsSync(workspaceRoot)) {
        fs.mkdirSync(workspaceRoot, { recursive: true });
    }
    // Create dummy files if they don't exist
    const dummyFiles = ['soul.md', 'user.md', 'AGENTS.md', 'IDENTITY.md', 'memory.md'];
    for (const f of dummyFiles) {
        const filePath = path.join(workspaceRoot, f);
        if (!fs.existsSync(filePath)) {
            fs.writeFileSync(filePath, `# Dummy ${f}\nContent of ${f}`, 'utf8');
        }
    }

    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const assembler = new PromptAssembler(workspaceRoot, dialogueMemory);

    const callId = 'test-call-id';
    const state: ShadowState = {
        mode: 'general',
        metadata: { compact_persona: 'Test Persona from Metadata' },
        lastUpdated: Date.now()
    };

    console.log('--- Test 1: First call (should load files) ---');
    const p1 = await assembler.assemblePrompt('SLC', callId, state, false);
    console.log('SLC Prompt preview:', p1.substring(0, 100) + '...');
    
    // Accessing private member for verification
    const isLoaded1 = (assembler as any).cacheLoaded;
    console.log('Cache loaded after 1st call:', isLoaded1);

    console.log('\n--- Test 2: Second call (should use cache) ---');
    const startTime = Date.now();
    const p2 = await assembler.assemblePrompt('SLC', callId, state, false);
    const duration = Date.now() - startTime;
    console.log('Second call duration:', duration, 'ms');
    
    const isLoaded2 = (assembler as any).cacheLoaded;
    console.log('Cache loaded after 2nd call:', isLoaded2);
    
    if (isLoaded1 && isLoaded2 && p1.includes('Test Persona from Metadata')) {
        console.log('\n✅ Verification Success: PromptAssembler correctly assembled prompt and used cache.');
    } else {
        console.error('\n❌ Verification Failed.');
    }

    console.log('\n--- Test 3: getContextPrompts ---');
    const cp = await assembler.getContextPrompts(callId, state, true);
    console.log('Context Prompt preview:', cp.substring(0, 100) + '...');

    console.log('\n--- Test 4: getCompactPersona ---');
    const compact = await assembler.getCompactPersona();
    console.log('Compact Persona:', compact);
}

main().catch(console.error);
