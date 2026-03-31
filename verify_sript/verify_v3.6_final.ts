import { PromptAssembler } from '../src/agent/prompt-assembler';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { ShadowManager } from '../src/agent/shadow-manager';
import { FastAgentV3 } from '../src/agent/fast-agent-v3';
import * as fs from 'fs';
import * as path from 'path';

// Mock workspace
const mockWorkspace = path.join(__dirname, 'mock_workspace_v36');
if (!fs.existsSync(mockWorkspace)) {
    fs.mkdirSync(mockWorkspace);
}
fs.writeFileSync(path.join(mockWorkspace, 'soul.md'), 'You are Jarvis.');
fs.writeFileSync(path.join(mockWorkspace, 'user.md'), 'User is Rhett.');
fs.writeFileSync(path.join(mockWorkspace, 'AGENTS.md'), 'Agents list...');
fs.writeFileSync(path.join(mockWorkspace, 'IDENTITY.md'), 'Jarvis Identity...');
fs.writeFileSync(path.join(mockWorkspace, 'memory.md'), 'Long term memory...');

async function runTests() {
    console.log('--- Starting V3.6 Final Verification ---');

    const memory = new DialogueMemory(mockWorkspace);
    const assembler = new PromptAssembler(mockWorkspace, memory);
    const shadow = new ShadowManager(mockWorkspace);
    const callId = 'test-call-id';

    // Test 1: Scenario Isolation
    console.log('Test 1: Scenario Isolation...');
    const scenarios = ['ROUTING', 'DECIDING', 'REFINING', 'SUMMARIZING', 'ASR_CORRECTION'] as const;
    for (const s of scenarios) {
        const payload = await assembler.assembleSLEPayload(s, callId, {
            text: 'Hello',
            intentHint: 'chat',
            canvasSnapshot: '{}',
            fullPersonaContext: 'Persona context'
        });

        console.log(`Checking scenario ${s}...`);
        // Basic check for scenario-specific protocols
        const contentStr = JSON.stringify(payload);
        if (s === 'ROUTING') {
            if (!contentStr.includes('任务分流器')) throw new Error('ROUTING missing protocol (任务分流器)');
            if (contentStr.includes('行动指令')) throw new Error('ROUTING contaminated with ACTION_PROTOCOL');
        }
        if (s === 'DECIDING') {
            if (!contentStr.includes('行动指令')) throw new Error('DECIDING missing protocol (行动指令)');
            if (contentStr.includes('任务分流器')) throw new Error('DECIDING contaminated with INTENT_ROUTER');
        }
    }
    console.log('Test 1 Passed.');

    // Test 2: Facade Link Simulation (Basic check only, full mock of OpenAI is complex for a script)
    console.log('Test 2: fullSoul Decontamination Audit...');
    const srcDir = path.join(__dirname, 'src');
    const walk = (dir: string): string[] => {
        let results: string[] = [];
        const list = fs.readdirSync(dir);
        list.forEach(file => {
            file = path.resolve(dir, file);
            const stat = fs.statSync(file);
            if (stat && stat.isDirectory()) results = results.concat(walk(file));
            else if (file.endsWith('.ts')) results.push(file);
        });
        return results;
    };

    const tsFiles = walk(srcDir);
    let fullSoulCount = 0;
    tsFiles.forEach(f => {
        const content = fs.readFileSync(f, 'utf8');
        // Extract lines with fullSoul to see if they are just comments
        const lines = content.split('\n');
        lines.forEach((line, idx) => {
            if (line.includes('fullSoul') && !line.trim().startsWith('//') && !line.includes('/*') && !line.includes('*') && !line.includes('[V3.6.0]')) {
                console.warn(`Potential fullSoul usage at ${f}:${idx + 1}: ${line}`);
                fullSoulCount++;
            }
        });
    });

    if (fullSoulCount > 0) {
        throw new Error(`Found ${fullSoulCount} active fullSoul references in code!`);
    }
    console.log('Test 2 Passed (No active fullSoul code detected).');

    // Test 3: ASR Decontamination
    console.log('Test 3: ASR Decontamination check...');
    const decidingPayload = await assembler.assembleSLEPayload('DECIDING', callId, { text: 'test' });
    const systemMsg = decidingPayload.find(m => m.role === 'system')?.content || '';
    if (systemMsg.includes('SLE_ASR_CORRECTION_PROTOCOL')) {
        throw new Error('DECIDING scenario contains ASR correction protocol! Context pollution detected.');
    }
    console.log('Test 3 Passed.');

    console.log('--- All Tests Passed ---');
    process.exit(0);
}

runTests().catch(e => {
    console.error('Verification Failed:', e);
    process.exit(1);
});
