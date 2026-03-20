
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const client = new OpenAI({
    apiKey: process.env.FAST_AGENT_API_KEY || process.env.BAILIAN_API_KEY,
    baseURL: process.env.FAST_AGENT_BASE_URL || process.env.BAILIAN_BASE_URL
});

const SLC_MODEL = process.env.FAST_AGENT_SLC_MODEL || 'qwen-turbo';

interface Scenario {
    name: string;
    history: { role: string; content: string }[];
    context: string;
}

const scenarios: Scenario[] = [
    {
        name: "场景 A: 冷启动 (用户刚好开启通话但没说话)",
        history: [],
        context: "用户刚刚接通，还没有任何发言。你的角色是 Jarvis，一个优雅的管家。"
    },
    {
        name: "场景 B: 正在处理任务 (用户 30 秒前让查天气，后台正在查)",
        history: [
            { role: "user", content: "查一下今天深圳的天气。" },
            { role: "assistant", content: "好的先生，我正在为您查询深圳的实时天气情况，请稍候。" }
        ],
        context: "当前任务：查询深圳天气。状态：进行中。用户已经安静了 15 秒。"
    },
    {
        name: "场景 C: 任务刚结束 (已经播报过结果，用户没反馈)",
        history: [
            { role: "user", content: "查一下今天深圳的天气。" },
            { role: "assistant", content: "好的先生，我正在为您查询深圳的实时天气情况，请稍候。" },
            { role: "assistant", content: "(已完成任务) 先生，为您查到了。今天深圳晴转多云，气温 22 到 28 度，非常适合户外活动。" }
        ],
        context: "当前任务：查询深圳天气。状态：已完成并播报。用户在听完播报后沉默了 30 秒。"
    }
];

async function runSim(scenario: Scenario, isOptimized: boolean) {
    const slcPrompt = `[ Jarvis 核心人设快照 ]\n你是 Jarvis。用户是 先生。风格: 优雅管家。\n\n[ 当前环境 ]\n本地时间: 2026-03-20 16:30:00\n\n[ 背景信息 ]\n${scenario.context}`;

    let userContent = "";
    let shadowThought = "";

    if (isOptimized) {
        // 🚀 [V3.3.0] 优化后的逻辑
        userContent = "用户现在陷入了沉默，请你根据当前的对话背景，主动关心一下用户，或者针对正在处理的任务提供一些建议。";
        shadowThought = "(当前气氛有些安静。作为 Jarvis，我应该优雅地打破沉默。我会结合上下文想一个自然的话题，或者询问用户是否需要继续刚才的任务。)";
    } else {
        // ⚠️ [V3.2.0] 当前逻辑
        userContent = "给我打个招呼";
        shadowThought = "(用户沉默了一会，让我打个招呼)";
    }

    const messages = [
        { role: 'system', content: slcPrompt },
        ...scenario.history,
        { role: 'user', content: userContent },
        { role: 'assistant', content: shadowThought }
    ];

    try {
        const response = await client.chat.completions.create({
            model: SLC_MODEL,
            messages: messages as any,
            temperature: 0.8,
            max_tokens: 150
        });

        return response.choices[0].message.content;
    } catch (e: any) {
        return `Error: ${e.message}`;
    }
}

async function main() {
    console.log(`\n🚀 [Idle 质量对比测试] 模型: ${SLC_MODEL}\n`);

    for (const scene of scenarios) {
        console.log(`\n================================================================`);
        console.log(`🎬 ${scene.name}`);
        console.log(`================================================================`);

        process.stdout.write("⏳ 运行原始逻辑 (V3.2)... ");
        const originalResult = await runSim(scene, false);
        console.log("✅");

        process.stdout.write("⏳ 运行优化逻辑 (V3.3)... ");
        const optimizedResult = await runSim(scene, true);
        console.log("✅");

        console.log(`\n【原始 (V3.2)】:`);
        console.log(`- 输入: "给我打个招呼"`);
        console.log(`- 输出: \x1b[31m${originalResult}\x1b[0m`);

        console.log(`\n【优化 (V3.3)】:`);
        console.log(`- 输入: "用户沉默，请结合背景主动关心/推进..."`);
        console.log(`- 输出: \x1b[32m${optimizedResult}\x1b[0m`);
    }
}

main();
