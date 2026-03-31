import { SLEPayloadAssembler } from '../src/agent/sle-payload-assembler';

/**
 * OpenClaw V3.6.2 Phase 2: Message Layer Layered Processing Verification
 * 
 * 此脚本验证 DECIDING 场景中的消息分层逻辑：
 * 1. [Canvas Snapshot] 作为首个 User 消息独立存在，不再与历史混合。
 * 2. 对话历史 (Dialogue History) 随后独立 push。
 * 3. 移除了 Assistant (Shadow Thought) 预填充，保持场景纯净。
 */

async function verify() {
    console.log("--------------------------------------------------------------------------------");
    console.log("🔍 [V3.6.2 Verification Phase 2] 正在验证 DECIDING 场景消息分层...");
    console.log("--------------------------------------------------------------------------------");

    const agentsMd = "# Skill List\n- test_skill: description";
    const snapshotContent = '{"status": "testing", "last_spoken": "Hello"}';
    const intentHintContent = '测试意图';
    const params = {
        canvasSnapshot: snapshotContent,
        intentHint: intentHintContent,
        text: '这是最新的用户输入',
        dialogueHistory: [
            { role: 'user', content: '之前的问题' },
            { role: 'assistant', content: '之前的回答' }
        ]
    };

    try {
        const messages = await SLEPayloadAssembler.assemble('DECIDING', 'test-call', agentsMd, params);

        // 预期快照字符串
        const expectedSnapshotStr = `[Canvas Snapshot] ${snapshotContent}; [Intent Hint] ${intentHintContent}`;

        // 1. 验证首条消息是 System
        const sysMsg = messages[0];
        const isSystemOk = sysMsg && sysMsg.role === 'system';

        // 2. 验证首个 User 消息 (messages[1]) 仅包含 Snapshot
        const firstUserMsg = messages[1];
        const isSnapshotOnly = firstUserMsg && firstUserMsg.role === 'user' && firstUserMsg.content === expectedSnapshotStr;

        // 3. 验证历史记录独立存在 (messages[2] and messages[3])
        const historyStartIdx = 2;
        const historyMatched = params.dialogueHistory.every((h, i) =>
            messages[historyStartIdx + i].role === h.role && messages[historyStartIdx + i].content === h.content
        );

        // 4. 验证最新文本输入追加在末尾
        const lastMsg = messages[messages.length - 1];
        const hasCurrentInput = lastMsg.role === 'user' && lastMsg.content === params.text;

        // 5. 验证绝对没有 Assistant 结尾的 Shadow Thought (V3.6.1 遗留项移除验证)
        const noShadowThought = !messages.some(m => m.role === 'assistant' && (m.content.includes("(thought)") || m.content.includes("(shadow")));

        // 打印结果
        console.log(`- System 协议注入:        ${isSystemOk ? '✅ 正确' : '❌ 错误'}`);
        console.log(`- Snapshot 协议独立 (User): ${isSnapshotOnly ? '✅ 正确 (分层成功)' : '❌ 错误 (检测到混合或缺失)'}`);
        console.log(`- 历史记录独立性 (Push):    ${historyMatched ? '✅ 正确 (保持原样)' : '❌ 错误 (被篡改)'}`);
        console.log(`- 当前文本输入追加:        ${hasCurrentInput ? '✅ 是' : '❌ 否'}`);
        console.log(`- Shadow Thought 净化检查: ${noShadowThought ? '✅ 已移除 (场景纯净)' : '❌ 仍存在 (残留污染)'}`);

        let failed = false;
        if (!isSystemOk || !isSnapshotOnly || !historyMatched || !hasCurrentInput || !noShadowThought) {
            failed = true;
        }

        if (failed) {
            console.error("\n❌ [V3.6.2 Phase 2] 验证失败，请检查 sle-payload-assembler.ts 中的重构逻辑。");
            process.exit(1);
        } else {
            console.log("\n✅ [V3.6.2 Phase 2] 验证成功! DECIDING 场景已实现协议分层与场景净化。");
            process.exit(0);
        }
    } catch (e: any) {
        console.error("\n❌ [V3.6.2 Phase 2] 执行过程中出现异常:", e.message);
        process.exit(1);
    }
}

verify();
