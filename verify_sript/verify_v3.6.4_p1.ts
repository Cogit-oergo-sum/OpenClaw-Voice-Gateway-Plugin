import { CanvasManager } from '../src/agent/canvas-manager';
import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';
import * as path from 'path';

async function verify() {
    console.log("--------------------------------------------------------------------------------");
    console.log("🔍 [V3.6.4 Verification Phase 1] 正在验证核心流程瘦身与内存纯净化...");
    console.log("--------------------------------------------------------------------------------");

    const workspaceRoot = path.join(__dirname, '../');
    const canvasManager = new CanvasManager(workspaceRoot);
    const callId = 'test-session-364';

    // 1. 验证 CanvasManager.resetTaskStatus
    console.log("\n[Step 1] 验证 Canvas 内存净化 (Item 8)...");
    const canvas = canvasManager.getCanvas(callId);
    canvas.task_status.status = 'READY';
    canvas.task_status.summary = 'Old Summary';
    canvas.task_status.is_delivered = true;
    canvas.task_status.current_progress = 100;

    canvasManager.resetTaskStatus(callId);
    const resetCanvas = canvasManager.getCanvas(callId);
    
    const isResetOk = resetCanvas.task_status.status === 'PENDING' && 
                      resetCanvas.task_status.summary === '' && 
                      resetCanvas.task_status.is_delivered === false &&
                      resetCanvas.task_status.current_progress === 0;

    console.log(`- 内存状态重置: ${isResetOk ? '✅ 成功 (Memory Purified)' : '❌ 失败'}`);

    // 2. 验证 SLEPayloadAssembler.assemble ('DECIDING') 消息扁平化
    console.log("\n[Step 2] 验证 DECIDING 消息扁平化 (Item 3)...");
    const agentsMd = "# Skill List\n- test_skill: description";
    const snapshotContent = '{"status": "testing"}';
    const params = {
        canvasSnapshot: snapshotContent,
        intentHint: '测试意图',
        text: '这是最新的用户输入',
        dialogueHistory: [
            { role: 'user', content: '之前的问题' },
            { role: 'assistant', content: '之前的回答' }
        ]
    };

    const messages = await SLEPayloadAssembler.assemble('DECIDING', callId, agentsMd, params);

    // 预期只有 2 条消息：1 System, 1 User
    const hasTwoMessages = messages.length === 2;
    const isSystemOk = messages[0].role === 'system';
    const isUserOk = messages[1].role === 'user';
    
    const userContent = messages[1].content;
    const hasSnapshot = userContent.includes('[Canvas Snapshot]');
    const hasHistory = userContent.includes('[Recent History]');
    const hasInput = userContent.includes('[Current Input]');
    const hasCorrectHistoryFormat = userContent.includes(' - [USER]: 之前的问题') && userContent.includes(' - [ASSISTANT]: 之前的回答');

    console.log(`- 消息数量为 2 (System + 1 User): ${hasTwoMessages ? '✅ 是' : '❌ 否'}`);
    const isFlattenedOk = hasSnapshot && hasHistory && hasInput && hasCorrectHistoryFormat;
    console.log(`- 内容扁平化结构验证: ${isFlattenedOk ? '✅ 成功' : '❌ 失败'}`);

    // 3. 验证触发器场景下的 Input 占位符
    const triggerParams = { ...params, text: '__INTERNAL_TRIGGER__' };
    const triggerMessages = await SLEPayloadAssembler.assemble('DECIDING', callId, agentsMd, triggerParams);
    const hasTriggerPlaceholder = triggerMessages[1].content.includes('(系统任务或闲置唤醒)');
    console.log(`- 内部触发器占位符验证: ${hasTriggerPlaceholder ? '✅ 成功' : '❌ 失败'}`);

    if (isResetOk && hasTwoMessages && isFlattenedOk && hasTriggerPlaceholder) {
        console.log("\n✅ [V3.6.4 Phase 1] 全部验证通过！核心流程已瘦身且内存已纯净化。");
        process.exit(0);
    } else {
        console.error("\n❌ [V3.6.4 Phase 1] 验证失败，请检查代码实现。");
        process.exit(1);
    }
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
