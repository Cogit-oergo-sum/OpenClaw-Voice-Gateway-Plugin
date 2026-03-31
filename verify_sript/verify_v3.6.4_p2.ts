import { buildShadowThought, SLE_ACTION_PROTOCOL, TASK_RESULT_SUMMARIZER_SYSTEM } from '../src/agent/prompts';

async function verify() {
    console.log("=== [V3.6.4_P2] SLE Protocol Reshape Verification ===");

    // 1. 验证 buildShadowThought 第一人称
    console.log("1. Checking buildShadowThought (First-person perspective)...");
    const shadowInternal = buildShadowThought('internal', '测试任务');
    const shadowWaiting = buildShadowThought('waiting', '测试任务');
    const shadowRefining = (buildShadowThought as any)('refining', '测试任务');

    console.log(`   - Internal: ${shadowInternal}`);
    console.log(`   - Waiting: ${shadowWaiting}`);
    console.log(`   - Refining: ${shadowRefining}`);

    if (!shadowInternal.includes('我要') || !shadowWaiting.includes('我目前') || !shadowRefining.includes('我要')) {
        throw new Error("Perspective error: buildShadowThought must use '我' instead of '你'.");
    }
    console.log("   ✅ Verification passed for buildShadowThought.");

    // 2. 验证 SLE_ACTION_PROTOCOL 实体提取要求
    console.log("2. Checking SLE_ACTION_PROTOCOL (Entity Extraction & Rewrite)...");
    if (!SLE_ACTION_PROTOCOL.includes('提取用户输入中的核心实体') || !SLE_ACTION_PROTOCOL.includes('Entity Extraction')) {
        throw new Error("Protocol error: SLE_ACTION_PROTOCOL must contain Entity Extraction requirements.");
    }
    if (!SLE_ACTION_PROTOCOL.includes('意图重构（Rewrite）')) {
        throw new Error("Protocol error: SLE_ACTION_PROTOCOL must contain Rewrite requirements.");
    }
    console.log("   ✅ Verification passed for SLE_ACTION_PROTOCOL.");

    // 3. 验证 SUMMARIZING 协议新字段
    console.log("3. Checking TASK_RESULT_SUMMARIZER_SYSTEM (Summarizing fields)...");
    if (!TASK_RESULT_SUMMARIZER_SYSTEM.includes('status') || !TASK_RESULT_SUMMARIZER_SYSTEM.includes('importance_score')) {
        throw new Error("Protocol error: TASK_RESULT_SUMMARIZER_SYSTEM must contain status and importance_score fields.");
    }
    if (!TASK_RESULT_SUMMARIZER_SYSTEM.includes('我是一个精准的信息提炼专家')) {
        throw new Error("Perspective error: TASK_RESULT_SUMMARIZER_SYSTEM role must be first-person.");
    }
    console.log("   ✅ Verification passed for TASK_RESULT_SUMMARIZER_SYSTEM.");

    console.log("\n✨ All V3.6.4_P2 Reshape Validations PASSED!");
    process.exit(0);
}

verify().catch(e => {
    console.error(`\n❌ Verification FAILED: ${e.message}`);
    process.exit(1);
});
