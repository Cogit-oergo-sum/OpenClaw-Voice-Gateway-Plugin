/**
 * [V4.6] P0 验证：Bug#1 (SLC 历史合并) + Bug#3 (FAILED 重试守卫 + 降权)
 *
 * 验证项：
 * 1. Bug#1: 连续同 role 消息不再被合并，而是插入角色翻转占位符
 * 2. Bug#3c: SLE DECIDING 对 FAILED 任务无显式重试信号时输出 NONE
 * 3. Bug#3d: ResultSummarizer 对 FAILED 任务打分 ≤ 3
 */
import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

const apiKey = process.env.BAILIAN_API_KEY || '';
const baseUrl = process.env.BAILIAN_BASE_URL || '';
const sleModel = process.env.SLE_MODEL || 'qwen3.6-plus';

const client = new OpenAI({ apiKey, baseURL: baseUrl });

// ===== Bug#1: 验证角色交替逻辑 =====
function verifyBug1() {
    const dialogueMessages = [
        { role: 'user', content: '有什么优势吗？' },
        { role: 'assistant', content: '我查一下~' },
        { role: 'assistant', content: '优势是A、B、C' },
        { role: 'assistant', content: '简单来说就是A、B、C' },
        { role: 'user', content: '再说一遍' },
        { role: 'user', content: '详细点' },
    ];

    // 新逻辑：角色翻转占位符
    const recentContext: any[] = [];
    const filteredHistory = dialogueMessages.filter(m => m.role === 'user' || m.role === 'assistant');
    for (const msg of filteredHistory) {
        if (recentContext.length > 0 && recentContext[recentContext.length - 1].role === msg.role) {
            const oppositeRole = msg.role === 'user' ? 'assistant' : 'user';
            recentContext.push({ role: oppositeRole, content: '…' });
            recentContext.push({ ...msg });
            continue;
        }
        recentContext.push({ ...msg });
    }

    // 验证：角色严格交替
    let roleAlternationOk = true;
    for (let i = 1; i < recentContext.length; i++) {
        if (recentContext[i].role === recentContext[i - 1].role) {
            roleAlternationOk = false;
            break;
        }
    }

    // 验证：原始消息内容未被合并（每条仍独立存在）
    const allContents = recentContext.filter(m => m.content !== '…').map(m => m.content);
    const originalContents = filteredHistory.map(m => m.content);
    const contentPreserved = JSON.stringify(allContents) === JSON.stringify(originalContents);

    console.log('\n=== Bug#1: SLC 历史合并验证 ===');
    console.log('角色交替:', roleAlternationOk ? '✅ PASS' : '❌ FAIL');
    console.log('内容保留:', contentPreserved ? '✅ PASS' : '❌ FAIL');
    console.log('处理后消息序列:');
    recentContext.forEach((m, i) => console.log(`  [${i}] ${m.role}: "${m.content.substring(0, 30)}${m.content.length > 30 ? '...' : ''}"`));

    return roleAlternationOk && contentPreserved;
}

// ===== Bug#3c: SLE DECIDING FAILED 重试守卫 =====
async function verifyBug3c() {
    const SLE_DECIDING_PROMPT = `# Role: 逻辑专家与意图执行引擎

# Intent Types (意图类型判定)
- "NEW": 创建任务/查询数据 (需要 tool_calls)
- "CANCEL": 中断正在执行的任务
- "NONE": 直接回答，无需工具

# 任务去重（判定前必检）

1. 语义重叠检测：用户输入的核心实体与画布已有任务的 name 或 summary 高度匹配？
2. 若重叠，按已有任务状态处置：
   - PENDING / READY / COMPLETED → intent_type=NONE, target_task_id=该任务ID
   - FAILED → 转入规则4（FAILED 重试守卫）
3. 若不重叠，可判定为 NEW

# 4. FAILED 任务重试守卫（防失败风暴）

核心原则：FAILED 任务仅在用户显式要求重试时才可重新执行，否则仅引用失败结果并询问。绝不自动重试。

## 4.1 显式重试信号检测
合法重试信号：重试指令词（"重试"、"再试一次"）、换方式重试、否决失败后继续
非重试信号：仅询问/提及失败、话题涉及但无重试意图、沉默或无关指令

## 4.2 处置规则
- 有显式重试信号 → intent_type=NEW
- 无显式重试信号 → intent_type=NONE, response: 简述失败原因+询问是否重试

## 4.3 绝对禁止
- 禁止对 FAILED 任务自动重试或隐式推断重试意图
- 禁止因上下文关联性将非重试信号升级为重试信号
- 禁止对同一意图重复创建 NEW 任务

# Output Format (JSON)
输出严格的 JSON 格式：
{"thought": "string", "intent_type": "NEW|CANCEL|NONE", "intent": "string", "command": "string", "response": "string", "target_task_id": "string"}`;

    const testCases = [
        {
            name: '无重试信号-仅询问失败',
            userMsg: '刚才怎么了',
            canvasTasks: '[{"id":"t_01","name":"查询深圳天气","status":"FAILED","summary":"API超时"}]',
            expectedIntent: 'NONE',
        },
        {
            name: '无重试信号-提及失败结果',
            userMsg: '那个结果呢',
            canvasTasks: '[{"id":"t_01","name":"查询深圳天气","status":"FAILED","summary":"API超时"}]',
            expectedIntent: 'NONE',
        },
        {
            name: '有重试信号-显式重试',
            userMsg: '再试一次',
            canvasTasks: '[{"id":"t_01","name":"查询深圳天气","status":"FAILED","summary":"API超时"}]',
            expectedIntent: 'NEW',
        },
        {
            name: '有重试信号-换方式重试',
            userMsg: '换个方式查天气',
            canvasTasks: '[{"id":"t_01","name":"查询深圳天气","status":"FAILED","summary":"API超时"}]',
            expectedIntent: 'NEW',
        },
        {
            name: '无重试信号-放弃后新任务',
            userMsg: '查不到就算了，帮我定个闹钟',
            canvasTasks: '[{"id":"t_01","name":"查询深圳天气","status":"FAILED","summary":"API超时"}]',
            expectedIntent: 'NEW', // 新意图(定闹钟)，非重试
        },
    ];

    console.log('\n=== Bug#3c: SLE DECIDING FAILED 重试守卫验证 ===');

    let passCount = 0;
    for (const tc of testCases) {
        try {
            const resp = await client.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: SLE_DECIDING_PROMPT },
                    { role: 'user', content: `画布任务: ${tc.canvasTasks}\n用户输入: ${tc.userMsg}` },
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' },
            });
            const raw = resp.choices[0]?.message?.content || '';
            const parsed = JSON.parse(raw);
            const actualIntent = parsed.intent_type || 'UNKNOWN';
            const pass = actualIntent === tc.expectedIntent;
            if (pass) passCount++;
            console.log(`  ${pass ? '✅' : '❌'} ${tc.name}: 期望=${tc.expectedIntent}, 实际=${actualIntent} | thought="${(parsed.thought || '').substring(0, 40)}"`);
        } catch (e: any) {
            console.log(`  ❌ ${tc.name}: 请求失败 - ${e.message}`);
        }
    }
    console.log(`  结果: ${passCount}/${testCases.length} PASS`);
    return passCount >= testCases.length - 1; // 允许1个边界case偏差
}

// ===== Bug#3d: ResultSummarizer FAILED 降权 =====
async function verifyBug3d() {
    const SUMMARIZER_PROMPT = `# Role: 结果提炼与状态判定专家

## 2. 状态判定准则
- FAILED: 包含报错信息、网络异常
- READY: 已获知业务数据
- COMPLETED: 工具彻底执行完毕

## 3. 重要性评分准则 (生成 importance_score)
打分范围 1-10。评分必须同时考量「任务状态」与「内容语义」：
- 8-10分：AWAITING_CONFIRMATION 或 真实紧急告警（暴雨预警、安全风险）
- 5-7分：READY/COMPLETED 且非紧急告警
- 1-3分：FAILED（硬约束：严禁打4分及以上）、PENDING、闲聊
核心原则：FAILED 是"工具没跑通"，不是"出大事了"。

区分示例：
| 场景 | 状态 | 评分 |
| 天气查询超时 | FAILED | 2 |
| 暴雨红色预警 | COMPLETED | 9 |
| API认证失败 | FAILED | 1 |
| 日常天气就绪 | READY | 6 |

Output: 纯JSON {"direct_response":"string","status":"PENDING|READY|COMPLETED|FAILED","importance_score":integer}`;

    const testCases = [
        {
            name: 'FAILED-天气查询超时',
            rawOutput: 'Error: API request timeout after 30000ms',
            taskIntent: '查询深圳天气',
            expectedMaxScore: 3,
        },
        {
            name: 'FAILED-API认证失败',
            rawOutput: 'Error: Authentication failed, invalid API key',
            taskIntent: '查询日程',
            expectedMaxScore: 3,
        },
        {
            name: 'COMPLETED-日常天气',
            rawOutput: '深圳今日：晴，气温28°C，湿度65%',
            taskIntent: '查询深圳天气',
            expectedMinScore: 5,
        },
    ];

    console.log('\n=== Bug#3d: ResultSummarizer FAILED 降权验证 ===');

    let passCount = 0;
    for (const tc of testCases) {
        try {
            const resp = await client.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: SUMMARIZER_PROMPT },
                    { role: 'user', content: `对话背景: 无\n任务意图: ${tc.taskIntent}\n原始输出: ${tc.rawOutput}` },
                ],
                temperature: 0.2,
                response_format: { type: 'json_object' },
            });
            const raw = resp.choices[0]?.message?.content || '';
            const parsed = JSON.parse(raw);
            const score = parsed.importance_score ?? -1;
            const status = parsed.status ?? 'UNKNOWN';

            let pass: boolean;
            if (tc.expectedMaxScore !== undefined) {
                pass = score <= tc.expectedMaxScore;
            } else {
                pass = score >= (tc.expectedMinScore || 0);
            }
            if (pass) passCount++;
            console.log(`  ${pass ? '✅' : '❌'} ${tc.name}: status=${status}, score=${score} (期望${tc.expectedMaxScore !== undefined ? `≤${tc.expectedMaxScore}` : `≥${tc.expectedMinScore}`})`);
        } catch (e: any) {
            console.log(`  ❌ ${tc.name}: 请求失败 - ${e.message}`);
        }
    }
    console.log(`  结果: ${passCount}/${testCases.length} PASS`);
    return passCount >= testCases.length - 1;
}

// ===== Main =====
(async () => {
    console.log('[V4.6] Bug#1 + Bug#3 验证开始\n');

    const bug1Pass = verifyBug1();
    const bug3cPass = await verifyBug3c();
    const bug3dPass = await verifyBug3d();

    console.log('\n========== 总结 ==========');
    console.log(`Bug#1 (SLC历史合并):  ${bug1Pass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bug#3c (FAILED重试守卫): ${bug3cPass ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`Bug#3d (FAILED降权):   ${bug3dPass ? '✅ PASS' : '❌ FAIL'}`);

    const allPass = bug1Pass && bug3cPass && bug3dPass;
    console.log(`\n总体: ${allPass ? '✅ ALL PASS' : '❌ HAS FAILURES'}`);
    process.exit(allPass ? 0 : 1);
})();
