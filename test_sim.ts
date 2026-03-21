import OpenAI from "openai";
import * as dotenv from "dotenv";

dotenv.config({ path: "./.env" });

const openai = new OpenAI({
    apiKey: process.env.FAST_AGENT_API_KEY || process.env.BAILIAN_API_KEY,
    baseURL: process.env.FAST_AGENT_BASE_URL || process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1'
});

async function simulate() {
    const model = process.env.FAST_AGENT_SLE_MODEL || process.env.FAST_AGENT_MODEL || process.env.BAILIAN_MODEL || 'qwen-plus';
    console.log(`[Simulator] Using Model: ${model}`);

    const systemPrompt = `你是一个沉思的后台智者（逻辑引擎 SLE_Agent）。
你在后台默默监控全量对话历史，你的唯一任务是：寻找由于语音识别（ASR）听错而导致的同音或近音词误识别。
注意：由于是同音词，当用户试图纠正发音时，输入的文本大概率**依然会被 ASR 识别成那个错误的词**！
例如用户说“不是A，是A”，你必须结合他补充的上下文线索（比如“冬天水汽凝固”），推理出与 A 读音非常相似但在上下文中才是正确的“真正的词”（比如B）。
一旦推断成功，必须立即调用 correct_asr_hotword 工具将这组误听记录提取出来。
严禁在此模式下回复任何自然语言，只允许静默调用工具。`;

    const testCases = [
        {
            desc: "1. 权利 / 权力",
            messages: [
                { role: 'user', content: '这是我的权力，你不能剥夺。' },
                { role: 'assistant', content: '您在管理岗位上确实有相应的权力。' },
                { role: 'user', content: '不是当官的那个权力，是作为公民合法享有的那个权力！' }
            ],
            wrong_word: "权力",
            expected: "权利"
        },
        {
            desc: "2. 形式 / 形势",
            messages: [
                { role: 'user', content: '现在的形式很不乐观啊。' },
                { role: 'assistant', content: '您是说会议的形式安排得不够好吗？' },
                { role: 'user', content: '不是外在的形式，是说目前整体的发展大环境的那个形式。' }
            ],
            wrong_word: "形式",
            expected: "形势"
        },
        {
            desc: "3. 报复 / 抱负",
            messages: [
                { role: 'user', content: '他是一个很有报复的年轻人。' },
                { role: 'assistant', content: '报复心太强可不太好，希望他能调整心态。' },
                { role: 'user', content: '不是打击报复，是说他有远大理想的那个报复。' }
            ],
            wrong_word: "报复",
            expected: "抱负"
        },
        {
            desc: "4. 修养 / 休养",
            messages: [
                { role: 'user', content: '他生病了，需要在家里修养一段时间。' },
                { role: 'assistant', content: '提升个人修养确实需要平时多看书多反思。' },
                { role: 'user', content: '不是品德修养，是生病后休息治病的那个修养。' }
            ],
            wrong_word: "修养",
            expected: "休养"
        },
        {
            desc: "5. 交代 / 胶带",
            messages: [
                { role: 'user', content: '帮我拿一下交代。' },
                { role: 'assistant', content: '您需要我给您什么交代？事情已经办妥了。' },
                { role: 'user', content: '不是说事情的交代，是粘纸箱子用的那个透明的交代。' }
            ],
            wrong_word: "交代",
            expected: "胶带"
        },
        {
            desc: "6. 声明 / 声名",
            messages: [
                { role: 'user', content: '这家公司在业内声明狼藉。' },
                { role: 'assistant', content: '他们发了什么公告或者公开声明吗？' },
                { role: 'user', content: '不是发公告的那个声明，是说他们的名气名声那个声明。' }
            ],
            wrong_word: "声明",
            expected: "声名"
        },
        {
            desc: "7. 必须 / 必需",
            messages: [
                { role: 'user', content: '那是生活必须品。' },
                { role: 'assistant', content: '生活确实有很多必须要做的事。' },
                { role: 'user', content: '不是一定得做的那个必须，是不可缺少的那个必须品。' }
            ],
            wrong_word: "必须",
            expected: "必需"
        },
        {
            desc: "8. 反应 / 反映",
            messages: [
                { role: 'user', content: '我要向上面反应一个问题。' },
                { role: 'assistant', content: '好的，您是对什么感到过敏或者有生理反应吗？' },
                { role: 'user', content: '不是身体的生理反应，是向上级报告情况的那个反应。' }
            ],
            wrong_word: "反应",
            expected: "反映"
        },
        {
            desc: "9. 品味 / 品位",
            messages: [
                { role: 'user', content: '这件衣服很有品味。' },
                { role: 'assistant', content: '这件衣服有什么特别的味道可以品尝吗？' },
                { role: 'user', content: '不是品尝味道的品味，是说格调很高雅的那个品味。' }
            ],
            wrong_word: "品味",
            expected: "品位"
        },
        {
            desc: "10. 检查 / 检察",
            messages: [
                { role: 'user', content: '这是检查院发来的公函。' },
                { role: 'assistant', content: '是指去医院做身体检查的机构吗？' },
                { role: 'user', content: '不是做体检的那个检查，是司法机关的那个检查院。' }
            ],
            wrong_word: "检查",
            expected: "检察"
        }
    ];

    let passed = 0;

    for (const test of testCases) {
        console.log(`\n=================================================`);
        console.log(`Testing Case: ${test.desc}`);

        const messages = [
            { role: 'system', content: systemPrompt },
            ...test.messages
        ];

        try {
            const response = await openai.chat.completions.create({
                model,
                messages: messages as any,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'correct_asr_hotword',
                            description: '提取并修正语音识别（ASR）因为发音相似导致的听写错误',
                            parameters: {
                                type: 'object',
                                properties: {
                                    wrong_word: { type: 'string', description: '被系统错误听写的词汇' },
                                    correct_word: { type: 'string', description: '用户实际表达的正确词汇（基于上下文推测的同音近音字）' }
                                },
                                required: ['wrong_word', 'correct_word']
                            }
                        }
                    }
                ],
                tool_choice: 'auto'
            });

            const msg = response.choices[0].message;
            if (msg.tool_calls && msg.tool_calls.length > 0) {
                const args = JSON.parse(msg.tool_calls[0].function.arguments);
                if (args.correct_word === test.expected || args.correct_word.includes(test.expected)) {
                    console.log(`✅ [Pass] Extracted Correct Word: "${args.correct_word}" (Wrong: "${args.wrong_word}")`);
                    passed++;
                } else {
                    console.log(`⚠️ [Partial/Fail] Extracted: "${args.correct_word}" but expected: "${test.expected}"`);
                }
            } else {
                console.log(`❌ [Fail] The LLM did not invoke the tool. Output: \n${msg.content}`);
            }
        } catch (err: any) {
            console.error("API Error: ", err.message);
        }
    }

    console.log(`\nResult: ${passed}/${testCases.length} Passed!`);
}

simulate().catch(console.error);
