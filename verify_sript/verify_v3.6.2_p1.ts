import { SLE_ACTION_PROTOCOL, LOGIC_EXPERT_IDENTITY, TTS_FRIENDLY_PROTOCOL } from '../src/agent/prompts';

/**
 * OpenClaw V3.6.2 Phase 1: SLE Action Protocol Standardization Verification
 * 
 * 此脚本验证 SLE_ACTION_PROTOCOL 经过标准化重构，移除了冗余的外部注入，
 * 并通过严格的 JSON 输出协议确保输出格式的一致性。
 */

console.log("--------------------------------------------------------------------------------");
console.log("🔍 [V3.6.2 Verification Phase 1] 正在验证 SLE_ACTION_PROTOCOL 标准化...");
console.log("--------------------------------------------------------------------------------");

// 1. 验证不再包含 TTS 友好协议文本 (及其核心标识：语音输出规范)
const hasLegacyTTS = SLE_ACTION_PROTOCOL.includes("语音输出规范") || SLE_ACTION_PROTOCOL.includes("Voice Output Rules");

// 2. 验证不再包含 LOGIC_EXPERT_IDENTITY 核心标识
const hasExpertIdentity = SLE_ACTION_PROTOCOL.includes("Soul-Logic-Expert");

// 3. 验证存在输出格式章节
const hasOutputSection = SLE_ACTION_PROTOCOL.includes("输出格式 (Output Format)");

// 4. 验证具体的 JSON 字段定义
const hasThoughtField = SLE_ACTION_PROTOCOL.includes("\"thought\"");
const hasIntentField = SLE_ACTION_PROTOCOL.includes("\"intent\"");
const hasResponseField = SLE_ACTION_PROTOCOL.includes("\"response\"");

console.log(`- 遗留 TTS 协议内容检查:   ${hasLegacyTTS ? '❌ 存在' : '✅ 已移除'}`);
console.log(`- 冗余身份注入检查:       ${hasExpertIdentity ? '❌ 存在' : '✅ 已移除'}`);
console.log(`- 输出格式章节存在:       ${hasOutputSection ? '✅ 是' : '❌ 否'}`);
console.log(`- 包含 thought 字段:      ${hasThoughtField ? '✅ 是' : '❌ 否'}`);
console.log(`- 包含 intent 字段:       ${hasIntentField ? '✅ 是' : '❌ 否'}`);
console.log(`- 包含 response 字段:     ${hasResponseField ? '✅ 是' : '❌ 否'}`);

// 导出字符串供潜在的自动化工具复用 (Requirement: "导出该 Prompt 字符串")
export { SLE_ACTION_PROTOCOL as FinalPrompt };

let failed = false;

if (hasLegacyTTS) {
    console.error("❌ 错误: SLE_ACTION_PROTOCOL 仍包含被废弃的语音输出规则内容。");
    failed = true;
}

if (hasExpertIdentity) {
    console.error("❌ 错误: SLE_ACTION_PROTOCOL 仍包含冗余的 SLE 专家身份定义。");
    failed = true;
}

if (!hasOutputSection || !hasThoughtField || !hasIntentField || !hasResponseField) {
    console.error("❌ 错误: SLE_ACTION_PROTOCOL 未定义或未正确定义标准的 JSON 输出结构。");
    failed = true;
}

if (failed) {
    console.error("\n❌ [V3.6.2 P1] 验证失败，请修正 prompts.ts 中的定义。");
    process.exit(1);
} else {
    console.log("\n✅ [V3.6.2 P1] 验证成功! SLE_ACTION_PROTOCOL 已符合标准化协议准则。");
    process.exit(0);
}
