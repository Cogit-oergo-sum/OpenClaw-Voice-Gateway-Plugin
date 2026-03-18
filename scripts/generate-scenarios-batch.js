const OpenAI = require('openai');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

const model = process.env.BAILIAN_MODEL || 'qwen-plus';

async function generateBatch(batchNum) {
    const prompt = `
你现在是一个 OpenClaw 资深测试工程师。
生成 20 个测试场景 (Batch ${batchNum}/5)。

类别覆盖：日常对话、快速任务处理、长/定时任务处理、反问追问场景。
每个场景必须包含: id, type, input, expected_behavior, description.

格式必须是标准的 JSON 数组。不要有多余的文字说明，不要用 markdown 包裹。
示例:
[
  {"id": "test_batch_${batchNum}_01", "type": "daily", "input": "...", "expected_behavior": "...", "description": "..."}
]
`;
    try {
        const res = await client.chat.completions.create({
            model: model,
            messages: [{ role: 'user', content: prompt }]
        });
        let content = res.choices[0].message.content.trim();
        content = content.replace(/^```json\n?/, '').replace(/\n?```$/, '').trim();
        
        // 尝试简单修复：移除末尾可能存在的多余逗号
        content = content.replace(/,\s*\]$/, ']');
        
        return JSON.parse(content);
    } catch (e) {
        console.error(`  Batch ${batchNum} Error: ${e.message}`);
        return [];
    }
}

async function main() {
    let all = [];
    // 加载已有场景
    const existingPath = path.join(__dirname, 'mil-spec-scenarios.json');
    if (fs.existsSync(existingPath)) {
        try {
            all = JSON.parse(fs.readFileSync(existingPath, 'utf8'));
            console.log(`Loaded ${all.length} existing scenarios.`);
        } catch (e) {}
    }

    for (let i = 1; i <= 5; i++) {
        console.log(`Generating batch ${i}...`);
        const batch = await generateBatch(i);
        if (batch.length > 0) {
            all = all.concat(batch);
            // 每次成功后保存一次，防止中途崩掉
            fs.writeFileSync(existingPath, JSON.stringify(all, null, 2));
            console.log(`  Added ${batch.length} scenarios. Total: ${all.length}`);
        }
    }
    console.log(`✅ Generation finished. Final total: ${all.length}`);
}

main().catch(console.error);
