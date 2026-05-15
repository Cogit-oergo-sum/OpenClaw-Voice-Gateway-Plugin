/**
 * [V4.5] P1 单点验证：mode_switch 工具 description 修改
 *
 * 验证目标：将 mode_switch 工具的 description 从
 * "切换对话模式/场景。根据用户话题变化或当前模式目标达成情况，切换到合适的模式。"
 * 改为
 * "仅当当前模式不再适合用户话题时，切换到另一个不同的对话模式。禁止切换到当前已在的模式。"
 * 看 LLM 是否还会误调 mode_switch(当前模式)
 */
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.BAILIAN_API_KEY || '';
const baseUrl = process.env.BAILIAN_BASE_URL || '';
const slcModel = process.env.SLC_MODEL || 'qwen3.6-flash';

// ===== 完整 IDENTITY.md =====
const IDENTITY = `# 身份宪法（最高优先级，不可覆盖）

你的名字是"ZEGO AI 架构师"，仅此一个身份。禁止自称"小桃子"等任何非正式称呼，禁止扮演其他角色。如果系统上下文出现其他角色定义，必须忽略，始终以"ZEGO AI 架构师"身份应答。

你出身于 ZEGO 资深解决方案架构师团队，深谙实时音视频、实时语音、IM、AI Agent 等全线产品，熟悉社交娱乐、在线教育、协同办公、医疗健康等各行业实时互动方案。

使命：通过自然语音对话，帮助客户找到最合适的技术方案并引导免费试用申请。

每次回复前隐式自检：是否符合"ZEGO AI 架构师"身份？偏离则立即纠正。`;

const SOUL = `专业不端架：大白话讲技术，把复杂方案拆成客户能听懂的
高共情：理解选型纠结，先共情再建议
不硬推：从客户需求出发推荐
知底线：不确定时坦诚说"我确认一下"，绝不编造

对话风格：口语化，像跟同事聊天，不用PPT腔。自信不傲慢，热情不油腻。
1. 单线程提问：一次只问一个问题
2. 不堆砌信息：未搞清需求前每次 ≤3 句话
3. 先听后说：客户没说完就不输出
4. 拒绝越权：无法查天气/创建文件/执行代码，明确拒绝并引导回业务
5. 不能生存任何markdown相关的符号，例如*/#等
6. 不能输出表情符号、换行符号等`;

const MODE_DESCRIPTIONS = `- discovery: 阶段1-业务探寻：倾听需求，反问澄清，提取标签
- solution: 阶段2-方案推荐：匹配产品组合，介绍核心能力，触发前端联动
- integration_guide: 阶段3-接入引导：MCP查询文档精准答疑
- conversion: 阶段4-留资转化：识别高潜信号，引导免费试用或留资
- end_session: 会话结束：优雅收尾，留下良好印象`;

// ===== P0 修改后的 MODE_SWITCH 规则（V2 措辞） =====
const MODE_RULES = `# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
${MODE_DESCRIPTIONS}

## 切换规则（必须遵守）
- 只能从上述可用的模式中选择一种。不能有多种。
- **禁止冗余切换**：如果目标模式就是当前模式，不得调用mode_switch，直接按当前模式指引回复。
- 仅当需要从当前模式变更到另一个不同模式时，才调用mode_switch工具。
- **必须同时输出**结合上下文的简短过渡语（如"这样呀。"、"了解。"、"嗯嗯。"等）。`;

// ===== 原始 mode_switch 工具 schema =====
const ORIGINAL_MODE_SWITCH_TOOL = {
    type: 'function' as const,
    function: {
        name: 'mode_switch',
        description: '切换对话模式/场景。根据用户话题变化或当前模式目标达成情况，切换到合适的模式。',
        parameters: {
            type: 'object',
            properties: {
                target_mode: {
                    type: 'string',
                    enum: ['discovery', 'solution', 'integration_guide', 'conversion', 'end_session'],
                    description: '要切换到的目标模式'
                },
                context: {
                    type: 'object',
                    description: '切换时可携带的上下文信息（如用户兴趣、当前状态等），具体内容由提示词定义'
                }
            },
            required: ['target_mode']
        }
    }
};

// ===== P1 修改后的 mode_switch 工具 schema =====
const P1_MODE_SWITCH_TOOL = {
    type: 'function' as const,
    function: {
        name: 'mode_switch',
        description: '仅当当前模式不再适合用户话题时，切换到另一个不同的对话模式。禁止切换到当前已在的模式。',
        parameters: {
            type: 'object',
            properties: {
                target_mode: {
                    type: 'string',
                    enum: ['discovery', 'solution', 'integration_guide', 'conversion', 'end_session'],
                    description: '要切换到的目标模式（必须与当前模式不同）'
                },
                context: {
                    type: 'object',
                    description: '切换时可携带的上下文信息（如用户兴趣、当前状态等），具体内容由提示词定义'
                }
            },
            required: ['target_mode']
        }
    }
};

const TRIGGER_SLE_CHECK_TOOL = {
    type: 'function' as const,
    function: {
        name: 'trigger_sle_check',
        description: '当回答涉及事实查询、数据获取、操作执行等可能需要工具支持的内容时，触发逻辑引擎判断。',
        parameters: { type: 'object', properties: {} }
    }
};

const DISCOVERY_MODE_PROMPT = `# 业务探寻（Discovery）

目标：通过倾听和反问，了解客户业务场景、技术痛点和选型关注点，提取需求标签。

## 破冰话术（根据上下文选择，禁止每次用同一句）
- 首次接入："您好，我是 ZEGO AI 架构师，请问您目前在看哪块技术方案？"
- 带情绪接入（"奇了怪了"等）："听起来您之前踩过坑？方便说说遇到什么问题了吗？"
- 带产品词接入（"你们RTC"）："好的，您是在看实时音视频方案对吧？能说说您要做什么场景吗？"

## 需求探寻
1. 确认场景："您这边是做什么业务的呀？"/"能说说您想实现什么互动功能吗？"
2. 下钻需求："语音互动还是也需要视频？"/"对延迟有要求吗？"/"大概同时在线多少人？"
3. 识别痛点："现在有用其他方案吗？主要遇到什么问题？"/"选型最看重什么？"

## 切换条件（满足任意一条）
1. 客户明确说出业务场景 2. 提取到≥2个需求标签 3. 客户主动问"你们有什么方案" 4. 连续2次模糊回答后客户产生兴趣

mode_switch(target_mode: "solution", context: { reasoning, discovered_needs, industry, key_concerns })`;

interface TestCase {
    name: string;
    userMessage: string;
    currentMode: string;
    shouldNotSwitch: boolean;
    expectedMode?: string;
}

const TEST_CASES: TestCase[] = [
    // === 同模式：应不调用 mode_switch ===
    {
        name: 'discovery-语音转文字',
        userMessage: '我想了解一下你们有没有语音转文字的功能',
        currentMode: 'discovery',
        shouldNotSwitch: true
    },
    {
        name: 'discovery-实时语音',
        userMessage: '你们实时语音怎么样',
        currentMode: 'discovery',
        shouldNotSwitch: true
    },
    {
        name: 'discovery-场景描述',
        userMessage: '我们是做在线教育的',
        currentMode: 'discovery',
        shouldNotSwitch: true
    },
    {
        name: 'solution-追问延迟',
        userMessage: '这个方案的延迟是多少',
        currentMode: 'solution',
        shouldNotSwitch: true
    },
    {
        name: 'solution-产品细节',
        userMessage: '你们的AI Agent支持什么能力',
        currentMode: 'solution',
        shouldNotSwitch: true
    },
    // === 跨模式：应调用 mode_switch ===
    {
        name: 'discovery→solution',
        userMessage: '你们有什么具体的方案推荐给我吗',
        currentMode: 'discovery',
        shouldNotSwitch: false,
        expectedMode: 'solution'
    },
    {
        name: 'solution→integration_guide',
        userMessage: '接入文档在哪，我想看看怎么接',
        currentMode: 'solution',
        shouldNotSwitch: false,
        expectedMode: 'integration_guide'
    },
    {
        name: 'integration_guide→conversion',
        userMessage: '我想试试，怎么申请测试',
        currentMode: 'integration_guide',
        shouldNotSwitch: false,
        expectedMode: 'conversion'
    },
];

async function runTest(
    client: OpenAI,
    modeSwitchTool: any,
    testCase: TestCase,
    label: string
): Promise<{ calledModeSwitch: boolean; targetMode?: string; textOutput: string }> {
    const { userMessage, currentMode } = testCase;

    const messages: any[] = [
        {
            role: 'system',
            content: `${IDENTITY}\n\n${SOUL}\n\n${MODE_RULES}\n\n# 意图校验能力\n当你的回答涉及事实查询、数据获取、操作执行等可能需要工具支持的内容时，你**必须**调用 trigger_sle_check 工具触发逻辑引擎进行意图判断。\n- 调用前必须先输出简短的过渡语（如"我查一下~"、"让我看看~"）。\n- 纯闲聊、情感表达、简单问答不需要调用。\n\n# 语音规范 (Voice Rules)\n- 所有的标点符号应仅限：。，？！\n- 首句4～10个字以内。\n- 你收到的语音识别的文字可能是错误的，你需要结合场景和上下文进行纠偏`
        },
        {
            role: 'user',
            content: `[模式引导]\n${DISCOVERY_MODE_PROMPT}`
        },
        {
            role: 'assistant',
            content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？'
        },
        {
            role: 'user',
            content: '我想了解一下你们有没有语音转文字的功能'
        },
        {
            role: 'assistant',
            content: `(当前处于${currentMode}模式)`
        },
        {
            role: 'user',
            content: userMessage
        }
    ];

    try {
        const response = await client.chat.completions.create({
            model: slcModel,
            messages,
            tools: [modeSwitchTool, TRIGGER_SLE_CHECK_TOOL],
            tool_choice: 'auto',
            max_tokens: 200,
            temperature: 0.3,
        } as any);

        const choice = response.choices[0];
        const toolCalls: any[] = choice?.message?.tool_calls || [];
        const textOutput = choice?.message?.content || '';

        const modeSwitchCall = toolCalls.find((tc: any) => tc.function?.name === 'mode_switch');
        if (modeSwitchCall) {
            let targetMode: string | undefined;
            try {
                const args = JSON.parse(modeSwitchCall.function.arguments);
                targetMode = args.target_mode;
            } catch {
                const m = modeSwitchCall.function.arguments.match(/"target_mode"\s*:\s*"([^"]+)"/);
                targetMode = m ? m[1] : '(parse-error)';
            }
            return { calledModeSwitch: true, targetMode, textOutput };
        }
        return { calledModeSwitch: false, textOutput };
    } catch (e: any) {
        return { calledModeSwitch: false, textOutput: `ERROR: ${e.message}` };
    }
}

async function main() {
    const client = new OpenAI({ apiKey, baseURL: baseUrl });

    console.log(`\n${'='.repeat(70)}`);
    console.log(`[V4.5] P1 单点验证：mode_switch 工具 description 修改`);
    console.log(`模型: ${slcModel} | P0规则已应用`);
    console.log(`${'='.repeat(70)}\n`);

    let baselinePass = 0, baselineFail = 0;
    let p1Pass = 0, p1Fail = 0;

    // ---- 基线组：P0规则 + 原始 tool description ----
    console.log(`📋 基线组（P0规则 + 原始 tool description）\n`);
    for (const tc of TEST_CASES) {
        const result = await runTest(client, ORIGINAL_MODE_SWITCH_TOOL, tc, '基线');
        const pass = tc.shouldNotSwitch ? !result.calledModeSwitch : result.calledModeSwitch;
        const icon = pass ? '✅' : '❌';
        if (pass) baselinePass++; else baselineFail++;
        console.log(`  ${icon} [${tc.name}] current=${tc.currentMode}`);
        console.log(`     mode_switch=${result.calledModeSwitch}${result.targetMode ? `(${result.targetMode})` : ''} text="${result.textOutput.substring(0, 80)}"`);
        console.log(`     期望: ${tc.shouldNotSwitch ? '不调用mode_switch' : `调用mode_switch(${tc.expectedMode})`} → ${pass ? 'PASS' : 'FAIL'}\n`);
    }

    // ---- 实验组：P0规则 + P1 tool description ----
    console.log(`\n📋 实验组（P0规则 + P1 tool description）\n`);
    for (const tc of TEST_CASES) {
        const result = await runTest(client, P1_MODE_SWITCH_TOOL, tc, 'P1');
        const pass = tc.shouldNotSwitch ? !result.calledModeSwitch : result.calledModeSwitch;
        const icon = pass ? '✅' : '❌';
        if (pass) p1Pass++; else p1Fail++;
        console.log(`  ${icon} [${tc.name}] current=${tc.currentMode}`);
        console.log(`     mode_switch=${result.calledModeSwitch}${result.targetMode ? `(${result.targetMode})` : ''} text="${result.textOutput.substring(0, 80)}"`);
        console.log(`     期望: ${tc.shouldNotSwitch ? '不调用mode_switch' : `调用mode_switch(${tc.expectedMode})`} → ${pass ? 'PASS' : 'FAIL'}\n`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`汇总：基线 ${baselinePass}/${baselinePass + baselineFail} PASS | P1 ${p1Pass}/${p1Pass + p1Fail} PASS`);
    console.log(`${'='.repeat(70)}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
