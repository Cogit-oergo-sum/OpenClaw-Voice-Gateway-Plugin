const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

const model = process.env.BAILIAN_MODEL || 'qwen-plus';

const prompt = `
你现在是一个 OpenClaw 智能体系统的资深测试工程师。
生成 30 个模拟用户与语音助手 Jarvis 交互的 JSON 场景（为了稳定性先分批生成）。

包含：
1. **日常对话** (问候、闲谈、情绪)。
2. **快速任务** (查天气、查 CPU、创建文件)。
3. **长任务/异步** (定时提醒、繁重邮件、重构)。
4. **反问追问** (系统问用户问题，如“邮件发给谁？”)。

格式：
[
  {"id": "test_01", "type": "daily", "input": "...", "expected_behavior": "..."},
  ...
]
请直接给出 JSON，不要 markdown 包包裹。
`;

async function main() {
    console.log("Starting batch 1 generation...");
    const res = await client.chat.completions.create({
        model: model,
        messages: [{ role: 'user', content: prompt }]
    });

    let content = res.choices[0].message.content.trim();
    // 移除潜在的 markdown 标记
    content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '');
    
    fs.writeFileSync(path.join(__dirname, 'mil-spec-scenarios.json'), content);
    console.log("Generated batch 1 successfully.");
}

main().catch(console.error);
