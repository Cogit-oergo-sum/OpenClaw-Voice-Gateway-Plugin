import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import * as fs from 'fs';
import * as path from 'path';

async function testV3_6_1_P1() {
    console.log("--- [V3.6.1 Phase 1 & 3 Verification] ---");
    const workspaceRoot = path.join(process.cwd(), 'tmp_p1_verify');
    if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot);

    // 注入必备文件
    fs.writeFileSync(path.join(workspaceRoot, 'AGENTS.md'), '# Agents Policy\n- Keep it cool.\n- Do not spam.');
    fs.writeFileSync(path.join(workspaceRoot, 'soul.md'), 'You are Jarvis.');
    fs.writeFileSync(path.join(workspaceRoot, 'user.md'), 'User is Master.');
    fs.writeFileSync(path.join(workspaceRoot, 'IDENTITY.md'), 'Internal ID: 007');
    fs.writeFileSync(path.join(workspaceRoot, 'memory.md'), 'No memory.');

    const canvasManager = new CanvasManager(workspaceRoot);
    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const assembler = new PromptAssembler(workspaceRoot, dialogueMemory, canvasManager);

    const callId = 'test-v361-p1';

    // 1. 验证 ROUTING 场景的瘦身
    console.log("\n[1] Testing ROUTING Payload Slimming...");
    const routingPayload = await assembler.assembleSLEPayload('ROUTING', callId, { text: '帮我查下天气' });
    const routingSystemMessage = routingPayload.find(m => m.role === 'system')?.content || '';

    const agentsMdContent = fs.readFileSync(path.join(workspaceRoot, 'AGENTS.md'), 'utf8');
    const isSlimmed = !routingSystemMessage.includes(agentsMdContent);
    const hasSkillSummary = routingSystemMessage.includes('[ 可用长耗时意图清单 ]');

    console.log(`- System Message Content:\n${routingSystemMessage}`);
    console.log(`- Full AGENTS.md content check: ${isSlimmed ? 'Clean (REMOVED)' : 'DIRTY (STILL THERE)'}`);
    console.log(`- Has Skill Summary: ${hasSkillSummary}`);

    if (!isSlimmed || !hasSkillSummary) {
        console.error("FAIL: ROUTING payload is not slimmed correctly!");
        process.exit(1);
    }

    // 2. 验证 ASR 纠错模版标准化
    console.log("\n[2] Testing ASR Correction Template...");
    const asrPayload = await assembler.assembleSLEPayload('ASR_CORRECTION', callId, {
        text: '你好',
        recentHistoryRaw: '之前聊了天气'
    });
    const asrUserMessage = asrPayload.find(m => m.role === 'user')?.content || '';

    console.log(`- ASR User Message: ${asrUserMessage}`);
    const expectedPrefix = "纠错判定指令：";
    const hasCorrectTemplate = asrUserMessage.startsWith(expectedPrefix);

    console.log(`- Has Correct Template Prefix: ${hasCorrectTemplate}`);

    if (!hasCorrectTemplate) {
        console.error("FAIL: ASR template is not applied correctly!");
        process.exit(1);
    }

    // 3. 验证 DECIDING 场景仍然包含 AGENTS.md (确保不误删)
    console.log("\n[3] Testing DECIDING Payload Integrity...");
    const decidingPayload = await assembler.assembleSLEPayload('DECIDING', callId, { text: '执行任务' });
    const decidingSystemMessage = decidingPayload.find(m => m.role === 'system')?.content || '';
    const hasAgentsInDeciding = decidingSystemMessage.includes(agentsMdContent.trim());

    console.log(`- Has AGENTS.md in DECIDING: ${hasAgentsInDeciding}`);
    if (!hasAgentsInDeciding) {
        console.error("FAIL: DECIDING payload should still contain AGENTS.md!");
        process.exit(1);
    }

    console.log("\n--- [VERIFICATION SUCCESSFUL] ---");
    // 清理
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    process.exit(0);
}

testV3_6_1_P1().catch(e => {
    console.error(e);
    process.exit(1);
});
