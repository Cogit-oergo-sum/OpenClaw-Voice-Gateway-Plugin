import * as fs from 'fs';
import * as path from 'path';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { CanvasManager } from '../src/agent/canvas-manager';
import { ShadowState } from '../src/agent/shadow-manager';

async function verify() {
    console.log('--- 校验 SLC TTS 规范注入 ---');
    const mockWorkspace = path.join(process.cwd(), 'tmp_mock_workspace_' + Date.now());
    fs.mkdirSync(mockWorkspace, { recursive: true });
    
    // Create necessary files
    fs.writeFileSync(path.join(mockWorkspace, 'soul.md'), '# Jarvis Soul\nStyle: Professional');
    fs.writeFileSync(path.join(mockWorkspace, 'user.md'), 'Name: Rhett');
    fs.writeFileSync(path.join(mockWorkspace, 'AGENTS.md'), '');
    fs.writeFileSync(path.join(mockWorkspace, 'IDENTITY.md'), '');
    fs.writeFileSync(path.join(mockWorkspace, 'memory.md'), '');

    const dialogueMemory = new DialogueMemory(mockWorkspace);
    const canvasManager = new CanvasManager(mockWorkspace);
    const assembler = new PromptAssembler(mockWorkspace, dialogueMemory, canvasManager);

    const callId = 'test-call-id';
    const state: ShadowState = {
        metadata: {
            compact_persona: 'Test Persona'
        }
    } as any;

    const prompt = await assembler.assemblePrompt('SLC', callId, state);
    console.log('--- Assembled Prompt ---');
    console.log(prompt);
    console.log('------------------------');

    const keyword = '语音输出规范';
    if (prompt.includes(keyword)) {
        console.log(`\n✅ 验证成功: Prompt 包含关键字 "${keyword}"`);
    } else {
        console.error(`\n❌ 验证失败: Prompt 未包含关键字 "${keyword}"`);
        process.exit(1);
    }

    // Cleanup
    fs.rmSync(mockWorkspace, { recursive: true, force: true });
}

verify().catch(err => {
    console.error(err);
    process.exit(1);
});
