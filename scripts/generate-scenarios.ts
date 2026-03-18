import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

const model = process.env.BAILIAN_MODEL || 'qwen-plus';

const GENERATION_PROMPT = `
你现在是一个 OpenClaw 智能体系统的资深测试工程师。
你需要生成 100 个模拟用户与语音助手 Jarvis 交互的测试场景。

输出为一个 JSON 数组，每个元素包含：
- "id": 唯一标识
- "type": "daily" | "fast" | "long"
- "input": 用户原话
- "expected_behavior": 期望的行为描述

请直接输出 JSON，不要有任何 Markdown 代码块包裹，不要有前导或后缀文字。
`;

async function generateScenarios() {
    console.log(`正在生成测试场景...`);
    
    try {
        const res = await client.chat.completions.create({
            model: model,
            messages: [{ role: 'user', content: GENERATION_PROMPT }]
        });

        const content = res.choices[0].message.content || '{"scenarios": []}';
        const data = JSON.parse(content);
        
        const scenarios = data.scenarios || data; // 兼容不同结构

        const filePath = path.join(__dirname, 'mil-spec-scenarios.json');
        fs.writeFileSync(filePath, JSON.stringify(scenarios, null, 2));
        
        console.log(`✅ 已生成 ${scenarios.length} 个场景，保存至: ${filePath}`);
    } catch (e: any) {
        console.error(`生成失败: ${e.message}`);
    }
}

generateScenarios();
