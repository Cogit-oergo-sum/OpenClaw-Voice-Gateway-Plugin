import OpenAI from 'openai';
import * as dotenv from 'dotenv';

dotenv.config();

const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

const model = process.env.BAILIAN_MODEL || 'qwen-plus';

/**
 * 仿真并联接力逻辑的核心函数
 */
async function simulateRelay(scenarioName: string, userInput: string, mockFiller: string, toolResult: string) {
    console.log(`\n=== [测试场景: ${scenarioName}] ===`);
    console.log(`[User]: ${userInput}`);
    console.log(`[Phase 1 - 抢跑垫话]: ${mockFiller}`);

    // 这里模拟缝合逻辑：将抢跑的垫话作为 Assistant 已经发出的内容回填
    const messages = [
        { role: 'system', content: '你是由 OpenClaw 驱动的极客助手 Jarvis。风格简洁、高情商。' },
        { role: 'user', content: userInput },
        // 关键：将抢跑内容“接力”回上下文
        { role: 'assistant', content: mockFiller },
        { role: 'system', content: `[后台工具执行结果]: ${toolResult}` }
    ];

    console.log(`[Phase 2 - 发起缝合请求]...`);
    const start = Date.now();
    try {
        const response = await client.chat.completions.create({
            model: model,
            messages: messages as any,
        });

        const finalReply = response.choices[0].message.content;
        console.log(`[Phase 2 - 最终接力回复]: ${finalReply}`);
        console.log(`[检测结果]: ${finalReply?.includes(mockFiller.substring(0, 5)) ? '❌ 发现复读！' : '✅ 逻辑衔接完美'}`);
        console.log(`[时延统计]: ${Date.now() - start}ms`);
    } catch (e: any) {
        console.error(`[Error]: ${e.message}`);
    }
}

async function runAllTests() {
    // 场景 1: 重构委托
    await simulateRelay(
        "重构委托 (Delegation)",
        "帮我重构一下 memory 模块",
        "收到。memory 模块的并发安全确实是个痛点。先生，我这就为您联系主 Agent 进行重构处理，请稍候。",
        "状态：任务已成功排队，主 Agent 正在扫描 src/context 目录。"
    );

    // 场景 2: 天气感官
    await simulateRelay(
        "天气带感官 (Weather)",
        "杭州现在还在下雨吗？我急着出门。",
        "这雨下得确实让人心烦，特别是您还有行程。先生，我这就为您调取最新的雷达图，稍微等我一下。",
        "结果：杭州余杭区正处于红色暴雨预警，预计未来一小时雨速 40mm/h。"
    );
}

runAllTests();
