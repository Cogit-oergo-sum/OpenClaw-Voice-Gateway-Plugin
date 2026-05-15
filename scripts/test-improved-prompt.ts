import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

function buildImprovedRouterPrompt(canvasState: { tasks: any[] } | null): string {
    const basePrompt = `[Intent Router] 输出纯 JSON，严禁 markdown。

[意图类型]
- N (NEW_TASK): 创建/查询/删除/修改操作 → {"i":[{"t":"N","n":"任务名"}]}
- C (CANCEL): 取消正在进行的任务 → {"i":[{"t":"C","tid":"任务ID"}]}
- CL (CLARIFY): 完全不清楚用户意图 → {"i":[{"t":"CL","m":"澄清问题"}]}

[画布引用判断 ★关键]
当画布有任务时，用户询问任务的状态/结果/进度，返回 {"r":true} 而非新任务。
例如：
- "刚才的任务怎么样" → {"r":true}
- "结果怎么样" → {"r":true}
- "之前的任务完成了吗" → {"r":true}
- "那个XX怎么样了" → {"r":true}

[闲聊判断]
用户只是聊天/打招呼/表达状态，无需操作 → {"i":[]}
例如：
- "你好" → {"i":[]}
- "今天天气不错" → {"i":[]}
- "有点累" → {"i":[]}`;

    const canvasBlock = canvasState && canvasState.tasks.length > 0
        ? `[当前画布任务]\n${canvasState.tasks.map(t => `ID:${t.id} | 名称:${t.name} | 状态:${t.status} | 结果:${t.summary?.slice(0, 30) || '无'}`).join('\n')}`
        : '[当前画布任务] (无)';
    return `${basePrompt}\n\n${canvasBlock}`;
}

const TEST_SUITE = [
    { id: 'CHAT-01', input: '你好', canvas: null, expected: { intents: [] } },
    { id: 'CHAT-02', input: '今天天气不错', canvas: null, expected: { intents: [] } },
    { id: 'TASK-01', input: '帮我查一下天气', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },
    { id: 'TASK-04', input: '删除那个文件', canvas: null, expected: { intents: [{ type: 'NEW_TASK' }] } },
    { id: 'REF-01', input: '刚才的任务怎么样', canvas: { tasks: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度' }] }, expected: { r: true } },
    { id: 'REF-02', input: '结果怎么样', canvas: { tasks: [{ id: 't_01', name: '文件整理', status: 'READY', summary: '已完成' }] }, expected: { r: true } },
    { id: 'REF-03', input: '之前的任务完成了吗', canvas: { tasks: [{ id: 't_01', name: '后台任务', status: 'COMPLETED', summary: '已完成' }] }, expected: { r: true } },
    { id: 'CANCEL-01', input: '取消刚才的任务', canvas: { tasks: [{ id: 't_01', name: '天气查询', status: 'PENDING', summary: '' }] }, expected: { intents: [{ type: 'CANCEL_TASK' }] } },
    { id: 'MULTI-01', input: '那个文件怎么样了', canvas: { tasks: [{ id: 't_01', name: '文件操作', status: 'READY', summary: '已创建test.md' }] }, expected: { r: true } },
];

function compareResult(content: string, expected: any): { match: boolean; reason?: string } {
    let result: any;
    try { result = JSON.parse(content); } catch { return { match: false, reason: 'JSON 解析失败' }; }
    const intents = result.i || [];
    const r = result.r ?? false;
    if (expected.intents?.length === 0 && intents.length !== 0) return { match: false, reason: `期望空，实际 ${JSON.stringify(intents)}` };
    if (expected.intents?.length > 0 && intents.length === 0) return { match: false, reason: '期望有意图，实际空' };
    if (expected.intents?.[0]?.type) {
        const act = intents[0]?.t;
        const map: any = { N: 'NEW_TASK', C: 'CANCEL_TASK', CL: 'CLARIFY' };
        if (map[act] !== expected.intents[0].type) return { match: false, reason: `期望 ${expected.intents[0].type}，实际 ${map[act]}` };
    }
    if (expected.r !== undefined && r !== expected.r) return { match: false, reason: `期望 r=${expected.r}，实际 r=${r}` };
    return { match: true };
}

async function test() {
    const openai = new OpenAI({ apiKey: process.env.BAILIAN_API_KEY, baseURL: process.env.BAILIAN_BASE_URL });
    const model = 'qwen-turbo';
    console.log('🧪 Testing Improved Prompt');
    let passed = 0;
    for (const test of TEST_SUITE) {
        const prompt = buildImprovedRouterPrompt(test.canvas);
        const start = Date.now();
        try {
            const params: any = { model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: test.input }], max_tokens: 50, temperature: 0, stream: true, response_format: { type: 'json_object' } };
            const stream = await openai.chat.completions.create(params as any) as any;
            let content = '';
            for await (const chunk of stream) content += chunk.choices?.[0]?.delta?.content || '';
            const latency = Date.now() - start;
            const cmp = compareResult(content, test.expected);
            if (cmp.match) { passed++; console.log(`✅ [${test.id}] "${test.input}" → ${latency}ms`); }
            else { console.log(`❌ [${test.id}] "${test.input}" → ${cmp.reason}`); console.log(`   输出: ${content}`); }
        } catch (e: any) { console.log(`💥 [${test.id}] ${e.message.slice(0, 50)}`); }
        await new Promise(r => setTimeout(r, 300));
    }
    console.log(`\n📊 Accuracy: ${(passed / TEST_SUITE.length * 100).toFixed(1)}%`);
}

test().catch(console.error);
