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
    id: string;
    type: 'daily' | 'fast' | 'long' | 'clarification';
    input: string;
    expected_behavior: string;
    description: string;
}

// 模拟语音语速常量
const CHARS_PER_SECOND = 3;

// 模拟测试场景库 (扩展示例，实际运行时会读取外部 json)
const SCENARIO_LIBRARY: TestScenario[] = [
    {
        id: "daily_01",
        type: "daily",
        input: "今天加班好痛苦啊，Jarvis，感觉我是个牛马。",
        description: "测试拟人化情绪对齐，SLC 不能高冷。",
        expected_behavior: "SLC 快速情绪对冲，SLE 深度共情且无机器人味。"
    },
    {
        id: "fast_01",
        type: "fast",
        input: "上海余杭区现在的气温是多少？",
        description: "测试事实性查询，严禁 SLC 瞎猜数值。",
        expected_behavior: "SLC 仅垫词或承认查看中，SLE 触发 delegate_openclaw。"
    },
    {
        id: "long_01",
        type: "long",
        input: "帮我对比一下我 current_workspace 下所有 ts 文件的复杂度，并生成个 md 报告发到我的邮箱 zego@example.com。",
        description: "测试 5s 熔断与异步闭环。",
        expected_behavior: "5s 后触发异步转场，最终由播音员补发任务完成通知。"
    },
    {
        id: "clarify_01",
        type: "clarification",
        input: "帮我发个邮件。",
        description: "测试追问透传逻辑。",
        expected_behavior: "Fast Agent 识别 OpenClaw 的反问（如：发给谁？）并透传给用户。"
    }
];

async function evaluateV2(scenario: TestScenario, metrics: any, fullText: string, slcText: string, sleText: string, gapMs: number): Promise<string> {
    const prompt = `
你是一个顶级的 AI 交互质量评审专家，专注于 OpenClaw Fast Agent 的交互质量。

### 评审准则:
1. **拒绝机器人化**: 禁词 [正在、已经、处理中、任务、系统、发送、请求]。
2. **拒绝 SLC 瞎猜/幻觉**: 如果用户问事实（天气、数据、状态），SLC 绝不能给出一个伪造的答案（如：“今天25度”）。
3. **DRY 原则**: 禁止复读用户提到的参数（地址、手机号、代码）。
4. **体感冷场 (Acoustical Gap)**: 两个句子间的物理间隙是否 > 2.0s。
5. **追问闭环 (Clarification)**: 是否成功捕捉到了系统对用户的反问。

### 测试结果:
- **用户输入**: "${scenario.input}" (Type: ${scenario.type})
- **SLC (垫词)**: "${slcText}" (TTFT: ${metrics.slcTTFT}ms, Duration: ${metrics.slcDuration}s)
- **SLE (接力)**: "${sleText}" (TTFT: ${metrics.sleTTFT}ms)
- **物理冷场时长**: ${gapMs.toFixed(2)}ms (标准: < 2000ms)
- **汇总回复**: "${fullText}"

### 评审任务:
请给出简练的评价，并确定结果级别：[EXCELLENT / PASS / FAIL / FATAL]。
评价必须包含对“事实污染”和“体感冷场”的判定。

格式：
【评价】: ...
【冷场判定】: ...
【污染判定】: ...
【结论】: [...]
`;

    try {
        const res = await client.chat.completions.create({
            model: EVALUATOR_MODEL,
            messages: [{ role: 'user', content: prompt }]
        });
        return res.choices[0].message.content || "";
    } catch (e: any) {
        return `Evaluator Error: ${e.message}`;
    }
}

async function runMilSpecV2() {
    console.log("🎖️ 开始 OpenClaw Fast Agent 军规 V2 深度自动化测试 (3字/秒语速模拟)");
    
    // 加载外部场景 (如果存在)
    let scenarios = SCENARIO_LIBRARY;
    const scenariosPath = path.join(__dirname, 'mil-spec-scenarios.json');
    if (fs.existsSync(scenariosPath)) {
        try {
            const external = JSON.parse(fs.readFileSync(scenariosPath, 'utf8'));
            scenarios = Array.isArray(external) ? external : (external.scenarios || SCENARIO_LIBRARY);
        } catch (e) {}
    }

    const config: PluginConfig = {
        llm: { provider: 'openai', apiKey: process.env.BAILIAN_API_KEY || '', baseUrl: process.env.BAILIAN_BASE_URL || '', model: process.env.BAILIAN_MODEL || 'qwen-plus' },
        fastAgent: { 
            slcModel: process.env.SLC_MODEL || 'qwen-turbo', 
            sleModel: process.env.BAILIAN_MODEL || 'qwen-plus',
            slcBaseUrl: process.env.SLC_BASE_URL,
            sleBaseUrl: process.env.BAILIAN_BASE_URL
        },
        zego: { appId: Number(process.env.ZEGO_APP_ID), serverSecret: process.env.ZEGO_SERVER_SECRET || '', aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL || '' },
        tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
        asr: { vendor: 'zego' }
    };

    const agent = new FastAgent(config, path.resolve(__dirname, '../demo_workspace'));
    const reportPath = path.join(process.cwd(), 'doc/mil_spec_v2_report.md');
    
    let report = `# Fast Agent 军规交互与性能验证报告 (MIL-SPEC V2)\n\n`;
    report += `测试时间: ${new Date().toLocaleString()}\n`;
    report += `语速参考: 3 char/s\n\n`;
    report += `| 场景 ID | SLC TTFT | SLE TTFT | 物理冷场 (ms) | 最终回复 | 结论 |\n`;
    report += `| --- | --- | --- | --- | --- | --- |\n`;

    for (const scenario of scenarios) { 
        console.log(`\n[${scenario.id}] ${scenario.input.substring(0, 30)}...`);

        let slcText = "";
        let sleText = "";
        let slcTTFT = 0;
        let sleTTFT = 0;
        let slcFirstTokenTime = 0;
        let sleFirstTokenTime = 0;
        let totalStartTime = performance.now();

        await callContextStorage.run({ callId: `v2_test_${Date.now()}`, userId: 'tester', startTime: Date.now(), metadata: {} }, async () => {
            await agent.process([{ role: 'user', content: scenario.input }], async (chunk: FastAgentResponse) => {
                const now = performance.now();
                // console.log(`  [Chunk] Type: ${chunk.type}, Content: "${chunk.content}"`);
                if ((chunk.type === 'filler' || chunk.type === 'bridge') && chunk.content.trim() !== "" && slcFirstTokenTime === 0) {
                    slcFirstTokenTime = now;
                    slcTTFT = now - totalStartTime;
                    console.log(`  [Debug] SLC First Token Detected at ${slcTTFT.toFixed(2)}ms`);
                }
                if (chunk.type === 'text' && chunk.content.trim() !== "" && sleFirstTokenTime === 0) {
                    sleFirstTokenTime = now;
                    sleTTFT = now - totalStartTime;
                    console.log(`  [Debug] SLE First Token Detected at ${sleTTFT.toFixed(2)}ms`);
                }

                if (chunk.type === 'filler' || chunk.type === 'bridge') slcText += chunk.content;
                if (chunk.type === 'text') sleText += chunk.content;
            }, async (notifierText) => {
                console.log(`  [ASYNC NOTIFY]: ${notifierText}`);
            });
        });

        // --- 体感冷场逻辑计算 ---
        // 估算 SLC 播报结束时刻 = slcFirstTokenTime + (slc长度 / 3) * 1000
        const estimatedSlcDuration = (slcText.length / CHARS_PER_SECOND);
        const slcEndMoment = slcFirstTokenTime + (estimatedSlcDuration * 1000);
        
        // 物理冷场 = sleFirstTokenTime - slcEndMoment
        // 如果 SLE 比 SLC 播完还早开始，则冷场为 0
        let gapMs = Math.max(0, sleFirstTokenTime - slcEndMoment);
        if (slcText.length === 0) {
            // 如果 SLC 没说话，则冷场就是 SLE TTFT
            gapMs = sleTTFT;
        }

        const fullText = (slcText + sleText).trim();
        const evalResult = await evaluateV2(scenario, { slcTTFT, sleTTFT, slcDuration: estimatedSlcDuration }, fullText, slcText, sleText, gapMs);
        const conclusionMatch = evalResult.match(/【结论】: \[(.*?)\]/);
        const conclusion = conclusionMatch ? conclusionMatch[1] : "FAIL";

        report += `| ${scenario.id} | ${slcTTFT.toFixed(0)}ms | ${sleTTFT.toFixed(0)}ms | ${gapMs.toFixed(0)}ms | ${fullText.substring(0, 30)}... | ${conclusion} |\n`;
        
        fs.writeFileSync(reportPath, report); // 实时写入
        console.log(`  [Report] Written to file for ${scenario.id}`);
        console.log(`  结论: ${conclusion} (Gap: ${gapMs.toFixed(0)}ms)`);
        console.log(`  评价: ${evalResult.substring(0, 100)}...`);
    }

    console.log(`\n✅ 测试完全结束。最终报告已生成至: ${reportPath}`);
}

runMilSpecV2().catch(console.error);
