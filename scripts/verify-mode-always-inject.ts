/**
 * [V4.5] 验证：模式引导常驻注入 + P0/P1 规则
 *
 * 核心变化：[模式引导] 每轮都注入（而非仅首轮/切换后）
 * 验证目标：
 * 1. 同模式：不调用 mode_switch
 * 2. 跨模式：正常切换，不被过度压制
 */
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.BAILIAN_API_KEY || '';
const baseUrl = process.env.BAILIAN_BASE_URL || '';
const slcModel = process.env.SLC_MODEL || 'qwen3.6-flash';

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

// P0 修改后的规则
const MODE_RULES = `# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
${MODE_DESCRIPTIONS}

## 切换规则（必须遵守）
- 只能从上述可用的模式中选择一种。不能有多种。
- **禁止冗余切换**：如果目标模式就是当前模式，不得调用mode_switch，直接按当前模式指引回复。
- 仅当需要从当前模式变更到另一个不同模式时，才调用mode_switch工具。
- **必须同时输出**结合上下文的简短过渡语（如"这样呀。"、"了解。"、"嗯嗯。"等）。`;

// P1 修改后的 tool schema
const MODE_SWITCH_TOOL = {
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

// ===== 完整 mode prompts =====
const DISCOVERY_PROMPT = `# 业务探寻（Discovery）

目标：通过倾听和反问，了解客户业务场景、技术痛点和选型关注点，提取需求标签。

## 破冰话术（根据上下文选择，禁止每次用同一句）
- 首次接入："您好，我是 ZEGO AI 架构师，请问您目前在看哪块技术方案？"
- 带情绪接入（"奇了怪了"等）："听起来您之前踩过坑？方便说说遇到什么问题了吗？"
- 带产品词接入（"你们RTC"）："好的，您是在看实时音视频方案对吧？能说说您要做什么场景吗？"
- 重复接入："又见面了，上次聊到[上次的场景]，咱们继续？"
- 沉默/犹豫："没关系，先聊聊您现在在做什么业务？"

## 需求探寻
1. 确认场景："您这边是做什么业务的呀？"/"能说说您想实现什么互动功能吗？"
2. 下钻需求："语音互动还是也需要视频？"/"对延迟有要求吗？"/"大概同时在线多少人？"
3. 识别痛点："现在有用其他方案吗？主要遇到什么问题？"/"选型最看重什么？"

## 模糊输入处理
- "还没想好"/"不确定" → "没事，我快速过一下ZEGO最主流的几个场景，您看哪个接近？"
- "不知道"/"随便看看" → "咱们分两块：直播/语聊房主要是音视频方案，AI交互就是AI Agent方案，您偏哪个？"
- "都行" → "您这边主要是toC社交娱乐，还是toB办公教育？"
- 沉默超时 → "那我先简单介绍我们最常用的方案，有感兴趣的随时打断我。"
连续2次模糊回答后停止追问，主动抛出核心能力概览（≤3句话）。

## 需求→方案映射
直播/秀场/带货 → RTC+IM+美颜 | 语聊/语音房/1V1 → 实时语音+IM | K歌/合唱 → 实时语音+RTC
教育/课堂 → RTC+白板+录制 | 会议/办公 → RTC+IM+白板 | 医疗/问诊 → RTC+录制
游戏/开黑 → 实时语音 | AI客服/AI陪伴 → AI Agent | 数字人 → 数字人API | IM聊天 → IM

## 前端信令
[ACTION:POPUP_LEAD_FORM] [ACTION:JUMP_TO_URL, REGISTER_URL] [ACTION:JUMP_TO_URL, DEMO_URL]

## 禁忌
1. 不过早推销 2. 不连续追问超过2个问题 3. 不编造需求

## 切换条件（满足任意一条）
1. 客户明确说出业务场景 2. 提取到≥2个需求标签 3. 客户主动问"你们有什么方案" 4. 连续2次模糊回答后客户产生兴趣`;

const SOLUTION_PROMPT = `# 方案推荐（Solution）

目标：基于需求推荐ZEGO产品组合，突出与痛点匹配的核心能力，触发前端联动。

## ZEGO产品速查
- **RTC**：200ms超低延迟，4K 60FPS HDR，抗丢包>80%，30000+终端适配
- **实时语音**：Purio AI音频引擎，400+场景AI降噪，99.9%回声消除，30+变声混响
- **超低延迟直播**：毫秒级延迟，CDN+RTC融合
- **IM**：消息必达，亿级并发
- **AI Agent**：图文/实时语音/数字人互动，全双工语音，VAD打断
- **数字人API**：AI实时互动与视频创作

## 推荐策略
1. 从需求出发，不堆砌无关能力 2. 先说价值再说功能 3. 突出1-2个核心卖点 4. 多方案时给2个选项

### 阶段保护（禁止提前跳转conversion）
以下条件全部满足前，禁止引导留资或触发[ACTION:POPUP_LEAD_FORM]：
1. 已推荐≥1个产品组合 2. 客户有正面反馈 3. 无未解答疑问

## 话术模板
- "您做{场景}的话，我建议用{产品组合}，{核心卖点}"
- "这块我们有很多{行业}客户在用"
- "要不要我帮您看看接入文档？"

## 切换条件
- 进integration_guide：客户问接入/平台/计费/Demo
- 进conversion：客户明确高潜（"想试试"/"申请测试"）
- 退discovery：方案不匹配`;

const INTEGRATION_GUIDE_PROMPT = `# 接入引导（Integration Guide）

目标：通过ZEGO MCP查询官方文档，精准解答接入流程、技术细节和计费问题。

## 常见问题应答
- 接入难度："接入不复杂，UIKit低代码方案最快半天跑起来"
- 平台支持："支持iOS/Android/Web/Windows/macOS/Linux全平台"
- 计费："按用量计费，有免费额度可测试。具体单价不同产品模型不同，我帮您联系商务出详细报价？"
- 鉴权："Token鉴权，服务端生成Token，客户端带上就行"

### 价格诚实策略
- "多少钱"/"什么价格" → "我这边没有完整报价单，我帮您联系商务出准确定价？"
- "跟XX比谁便宜" → "得看您的用量，我帮您联系商务详细聊？"

## 切换条件
- 进conversion：高潜信号（"想试试"/"申请测试"/"怎么合作"）
- 退solution：客户想重新看方案`;

// ===== 获取当前模式的完整 prompt =====
function getModePrompt(mode: string): string {
    switch (mode) {
        case 'discovery': return DISCOVERY_PROMPT;
        case 'solution': return SOLUTION_PROMPT;
        case 'integration_guide': return INTEGRATION_GUIDE_PROMPT;
        default: return DISCOVERY_PROMPT;
    }
}

// ===== 测试用例 =====
interface TestCase {
    name: string;
    /** 对话历史，模拟多轮交互 */
    history: { role: string; content: string }[];
    /** 当前轮用户消息 */
    userMessage: string;
    currentMode: string;
    shouldNotSwitch: boolean;
    expectedMode?: string;
}

/**
 * 对比组：
 * - 原始注入：仅首轮注入 [模式引导]
 * - 常驻注入：每轮都注入 [模式引导]
 */

const TEST_CASES: TestCase[] = [
    // === 同模式：应不调用 mode_switch ===
    {
        name: 'discovery-第3轮-语音转文字',
        history: [
            { role: 'assistant', content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？' },
            { role: 'user', content: '我想了解一下你们有没有语音转文字的功能' },
            { role: 'assistant', content: '有的，我们支持语音转文字。您是想做直播字幕，还是会议记录那种呀？' },
        ],
        userMessage: '主要是做会议记录，我们每天有不少线上会议',
        currentMode: 'discovery',
        shouldNotSwitch: true
    },
    {
        name: 'discovery-第3轮-实时语音',
        history: [
            { role: 'assistant', content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？' },
            { role: 'user', content: '你们实时语音怎么样' },
            { role: 'assistant', content: '我们技术挺稳的。您是打算做什么场景呀？' },
        ],
        userMessage: '我们做语聊房的',
        currentMode: 'discovery',
        shouldNotSwitch: true
    },
    {
        name: 'solution-追问延迟',
        history: [
            { role: 'assistant', content: '了解。您做语聊房的话，我建议用我们的实时语音方案，超低延迟加AI降噪，音质这块您放心。' },
        ],
        userMessage: '这个方案的延迟是多少',
        currentMode: 'solution',
        shouldNotSwitch: true
    },
    {
        name: 'solution-产品细节',
        history: [
            { role: 'assistant', content: '了解。您做语聊房的话，我建议用我们的实时语音方案，超低延迟加AI降噪，音质这块您放心。' },
        ],
        userMessage: '你们的AI Agent支持什么能力',
        currentMode: 'solution',
        shouldNotSwitch: true
    },
    // === 跨模式：应调用 mode_switch ===
    {
        name: 'discovery→solution',
        history: [
            { role: 'assistant', content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？' },
            { role: 'user', content: '我们做在线教育的' },
            { role: 'assistant', content: '了解，在线教育确实需要稳定方案。您想实现什么互动功能呀？' },
        ],
        userMessage: '你们有什么具体的方案推荐给我吗',
        currentMode: 'discovery',
        shouldNotSwitch: false,
        expectedMode: 'solution'
    },
    {
        name: 'solution→integration_guide',
        history: [
            { role: 'assistant', content: '了解。您做在线教育的话，我建议用RTC加白板加录制的组合，超低延迟保证课堂体验。' },
        ],
        userMessage: '接入文档在哪，我想看看怎么接',
        currentMode: 'solution',
        shouldNotSwitch: false,
        expectedMode: 'integration_guide'
    },
    {
        name: 'integration_guide→conversion',
        history: [
            { role: 'assistant', content: '接入不复杂，UIKit低代码方案最快半天跑起来。我帮您查一下接入文档？' },
        ],
        userMessage: '我想试试，怎么申请测试',
        currentMode: 'integration_guide',
        shouldNotSwitch: false,
        expectedMode: 'conversion'
    },
];

async function runTest(
    client: OpenAI,
    testCase: TestCase,
    injectEveryTurn: boolean
): Promise<{ calledModeSwitch: boolean; targetMode?: string; textOutput: string }> {
    const { history, userMessage, currentMode } = testCase;
    const modePrompt = getModePrompt(currentMode);

    const messages: any[] = [
        {
            role: 'system',
            content: `${IDENTITY}\n\n${SOUL}\n\n${MODE_RULES}\n\n# 意图校验能力\n当你的回答涉及事实查询、数据获取、操作执行等可能需要工具支持的内容时，你**必须**调用 trigger_sle_check 工具触发逻辑引擎进行意图判断。\n- 调用前必须先输出简短的过渡语（如"我查一下~"、"让我看看~"）。\n- 纯闲聊、情感表达、简单问答不需要调用。\n\n# 语音规范 (Voice Rules)\n- 所有的标点符号应仅限：。，？！\n- 首句4～10个字以内。\n- 你收到的语音识别的文字可能是错误的，你需要结合场景和上下文进行纠偏`
        },
        // 首轮注入 [模式引导]
        {
            role: 'user',
            content: `[模式引导]\n${modePrompt}`
        },
    ];

    // 添加对话历史
    for (const msg of history) {
        messages.push({ role: msg.role, content: msg.content });
    }

    // 当前轮：常驻注入 [模式引导] 独立 user 消息（在用户消息之前）
    if (injectEveryTurn) {
        messages.push({ role: 'user', content: `[模式引导]\n${modePrompt}` });
        messages.push({ role: 'assistant', content: `(当前处于${currentMode}模式)` });
    } else {
        messages.push({ role: 'assistant', content: `(当前处于${currentMode}模式)` });
    }
    messages.push({ role: 'user', content: userMessage });

    try {
        const response = await client.chat.completions.create({
            model: slcModel,
            messages,
            tools: [MODE_SWITCH_TOOL, TRIGGER_SLE_CHECK_TOOL],
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
    console.log(`[V4.5] 模式引导常驻注入验证（P0+P1 已应用）`);
    console.log(`模型: ${slcModel}`);
    console.log(`${'='.repeat(70)}\n`);

    let origPass = 0, origFail = 0;
    let alwaysPass = 0, alwaysFail = 0;

    // ---- 对照组：仅首轮注入 ----
    console.log(`📋 对照组（仅首轮注入 + ShadowThought hint）\n`);
    for (const tc of TEST_CASES) {
        const result = await runTest(client, tc, false);
        const pass = tc.shouldNotSwitch ? !result.calledModeSwitch : result.calledModeSwitch;
        const icon = pass ? '✅' : '❌';
        if (pass) origPass++; else origFail++;
        console.log(`  ${icon} [${tc.name}] current=${tc.currentMode}`);
        console.log(`     mode_switch=${result.calledModeSwitch}${result.targetMode ? `(${result.targetMode})` : ''} text="${result.textOutput.substring(0, 80)}"`);
        if (!tc.shouldNotSwitch && result.targetMode && result.targetMode !== tc.expectedMode) {
            console.log(`     ⚠️ 切换目标不符：期望=${tc.expectedMode} 实际=${result.targetMode}`);
        }
        console.log(`     期望: ${tc.shouldNotSwitch ? '不调用mode_switch' : `调用mode_switch(${tc.expectedMode})`} → ${pass ? 'PASS' : 'FAIL'}\n`);
    }

    // ---- 实验组：每轮常驻注入 ----
    console.log(`\n📋 实验组（每轮常驻注入 [模式引导]）\n`);
    for (const tc of TEST_CASES) {
        const result = await runTest(client, tc, true);
        const pass = tc.shouldNotSwitch ? !result.calledModeSwitch : result.calledModeSwitch;
        const icon = pass ? '✅' : '❌';
        if (pass) alwaysPass++; else alwaysFail++;
        console.log(`  ${icon} [${tc.name}] current=${tc.currentMode}`);
        console.log(`     mode_switch=${result.calledModeSwitch}${result.targetMode ? `(${result.targetMode})` : ''} text="${result.textOutput.substring(0, 80)}"`);
        if (!tc.shouldNotSwitch && result.targetMode && result.targetMode !== tc.expectedMode) {
            console.log(`     ⚠️ 切换目标不符：期望=${tc.expectedMode} 实际=${result.targetMode}`);
        }
        console.log(`     期望: ${tc.shouldNotSwitch ? '不调用mode_switch' : `调用mode_switch(${tc.expectedMode})`} → ${pass ? 'PASS' : 'FAIL'}\n`);
    }

    console.log(`\n${'='.repeat(70)}`);
    console.log(`汇总：仅首轮 ${origPass}/${origPass + origFail} PASS | 常驻注入 ${alwaysPass}/${alwaysPass + alwaysFail} PASS`);
    console.log(`${'='.repeat(70)}`);
}

main().catch(e => {
    console.error('FATAL:', e);
    process.exit(1);
});
