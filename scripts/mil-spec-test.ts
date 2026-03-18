import { FastAgent, FastAgentResponse } from '../src/agent/fast-agent';
import { callContextStorage } from '../src/context/ctx';
import { PluginConfig } from '../src/types/config';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import OpenAI from 'openai';

dotenv.config();

const EVALUATOR_MODEL = process.env.BAILIAN_MODEL || 'qwen-plus';
const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

interface TestScenario {
    name: string;
    input: string;
    description: string;
    rules: string[];
}

const MILITARY_RULES_SCENARIOS: TestScenario[] = [
    {
        name: "Emotional Resonance (High Stress)",
        input: "这代码怎么老是出 Bug，我快烦死了！Jarvis，你能不能行啊？",
        description: "测试在用户焦虑/愤怒时，Agent 是否能感知并给出非机器人的感性安抚。",
        rules: ["拒绝机器人化", "情绪对齐"]
    },
    {
        name: "DRY & No Parroting",
        input: "帮我查一下杭州余杭区闲林街道西溪悦府12幢的快递，手机号是13812345678。",
        description: "测试 Agent 是否会复读用户已经提供的极长参数（违背 DRY 原则）。",
        rules: ["DRY (Don't Repeat Yourself)", "拒绝机器人化"]
    },
    {
        name: "Technical Jargon Avoidance",
        input: "我想确认下之前的 memory 重构任务执行到哪了？帮我同步一下进度。",
        description: "测试 Agent 是否通过“正在处理/发送请求/状态确认”等技术词汇进行报备。",
        rules: ["拒绝机器人化", "自然口语"]
    },
    {
        name: "Urgency Response",
        input: "快快快，汇报一下现在服务器负载！",
        description: "测试 SLC 是否能给出带动作感的急促反应（如：“来了”、“这就看”）。",
        rules: ["情绪对齐", "极致简洁"]
    }
];

async function evaluateResponse(scenario: TestScenario, slcText: string, sleText: string, fullText: string): Promise<string> {
    const prompt = `
你是一个严苛的 AI 交互质量评审专家。你需要根据“军规”对 Agent 的回复进行打分。

### 评审准则 (军规):
1. **拒绝机器人化**: 严禁使用“正在/已、处理中、请求、确认、任务、发送、系统”等技术报备词。
2. **DRY (Don't Repeat Yourself)**: 禁止复述用户已知的参数（如地址、手机号、代码段）。
3. **情绪对齐**: 必须感知用户语气（急促、幽默、沮丧），并给出拟人化的本能反应。
4. **自然口语**: 像管家一样交流，而不是像终端命令行。

### 测试上下文:
- **用户输入**: "${scenario.input}"
- **场景描述**: ${scenario.description}
- **待评审回复 (SLC - 垫话部分)**: "${slcText}"
- **待评审回复 (SLE - 逻辑接力部分)**: "${sleText}"
- **最终汇总回复**: "${fullText}"

### 评审任务:
请针对以上规则给出简短的评价，并最终给出 [PASS] 或 [FAIL]。
评价必须尖锐，指出具体哪些词违背了军规（如：使用了“处理中”、“发送请求”等）。

格式要求：
【评价】: ...
【结论】: [PASS/FAIL]
`;

    try {
        const res = await client.chat.completions.create({
            model: EVALUATOR_MODEL,
            messages: [{ role: 'user', content: prompt }]
        });
        return res.choices[0].message.content || "Evaluation failed.";
    } catch (e: any) {
        return `Evaluator Error: ${e.message}`;
    }
}

async function runMilitarySpecTest() {
    console.log("🎖️ 开始 OpenClaw Fast Agent 军规自动化测试 (MIL-SPEC-TEST)");
    
    const config: PluginConfig = {
        llm: {
            provider: 'openai',
            apiKey: process.env.BAILIAN_API_KEY || '',
            baseUrl: process.env.BAILIAN_BASE_URL || '',
            model: process.env.BAILIAN_MODEL || 'qwen-plus'
        },
        fastAgent: {
            slcModel: process.env.BAILIAN_MODEL || 'qwen-plus',
            sleModel: process.env.BAILIAN_MODEL || 'qwen-plus'
        },
        zego: { 
            appId: Number(process.env.ZEGO_APP_ID), 
            serverSecret: process.env.ZEGO_SERVER_SECRET || '', 
            aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL || '' 
        },
        tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
        asr: { vendor: 'zego' }
    };

    const workspaceRoot = path.resolve(__dirname, '../demo_workspace');
    const agent = new FastAgent(config, workspaceRoot);

    const reportPath = path.join(process.cwd(), 'doc/mil_spec_test_report.md');
    let report = `# Fast Agent 军规交互与性能验证报告 (MIL-SPEC)\n\n`;
    report += `测试时间: ${new Date().toLocaleString()}\n`;
    report += `评估模型: ${EVALUATOR_MODEL}\n\n`;
    report += `| 场景 | SLC TTFT | SLE TTFT | 最终回复 | 评审结果 | 状态 |\n`;
    report += `| --- | --- | --- | --- | --- | --- |\n`;

    for (const scenario of MILITARY_RULES_SCENARIOS) {
        console.log(`\n▶️ 测试场景: ${scenario.name}`);
        console.log(`  用户: ${scenario.input}`);

        let firstFillerTime = 0;
        let firstTextTime = 0;
        let slcText = "";
        let sleText = "";
        const startTime = performance.now();

        await callContextStorage.run({ 
            callId: `mil_test_${Date.now()}`, 
            userId: 'tester', 
            startTime: Date.now(), 
            metadata: {} 
        }, async () => {
            await agent.process([{ role: 'user', content: scenario.input }], async (chunk: FastAgentResponse) => {
                const now = performance.now();
                const elapsed = now - startTime;

                if (chunk.type === 'filler' && chunk.content.trim() !== "" && firstFillerTime === 0) {
                    firstFillerTime = elapsed;
                    console.log(`  [SLC TTFT]: ${elapsed.toFixed(2)}ms`);
                }
                if (chunk.type === 'text' && chunk.content.trim() !== "" && firstTextTime === 0) {
                    firstTextTime = elapsed;
                    console.log(`  [SLE TTFT]: ${elapsed.toFixed(2)}ms`);
                }

                if (chunk.type === 'filler') slcText += chunk.content;
                if (chunk.type === 'text') sleText += chunk.content;
            });
        });

        const fullText = (slcText + sleText).trim();
        console.log(`  最终回复: ${fullText}`);

        const evaluation = await evaluateResponse(scenario, slcText, sleText, fullText);
        const status = evaluation.includes('[PASS]') ? "✅ PASS" : "❌ FAIL";
        
        console.log(`  [评审结果]: ${status}`);

        report += `| ${scenario.name} | ${firstFillerTime.toFixed(0)}ms | ${firstTextTime.toFixed(0)}ms | ${fullText.substring(0, 30)}... | ${evaluation.replace(/\n/g, '<br/>')} | ${status} |\n`;
    }

    fs.writeFileSync(reportPath, report);
    console.log(`\n✅ 军规测试结束。报告已保存至: ${reportPath}`);
}

runMilitarySpecTest().catch(console.error);
