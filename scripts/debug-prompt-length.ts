import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

/**
 * 分析 Prompt 长度对不同模型延迟的影响
 */

async function analyzePromptLengthImpact() {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    
    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    
    const models = ['qwen-turbo', 'qwen3-8b'];
    
    // 不同长度的 Prompt
    const prompts = [
        { name: '极简(50字)', content: '输出 JSON: {"i":[]} 如果闲聊。NO markdown.' },
        { name: '中等(200字)', content: `[Intent Router]
判断用户意图并输出 JSON：
- 纯闲聊/打招呼 → {"i":[]}
- 需执行操作（查、建、删、整理等）→ {"i":[{"t":"N","n":"<简短任务名>"}]}

示例：
"你好" → {"i":[]}
"帮我查天气" → {"i":[{"t":"N","n":"天气"}]}
严禁输出 markdown，直接输出纯 JSON。` },
        { name: '复杂(500字)', content: `[Intent Router - 详细版]
[可用技能清单]
1. weather_mcp - 天气查询
2. file_manager - 文件操作
3. delegate_openclaw - 任务委托

[Active Canvas]
t_01:天气查询(READY):北京晴天20度
t_02:文档整理(PENDING):正在处理

判断用户意图并输出 JSON：
- 纯闲聊/打招呼 → {"i":[]}
- 询问画布中任务的结果/状态 → {"r":true}
- 新任务 → {"i":[{"t":"N","n":"<简短名>"}]}
- 取消画布中的任务 → {"i":[{"t":"C"}]}

[示例]
"你好" → {"i":[]}
"刚才的任务怎么样" → {"r":true}
"取消它" → {"i":[{"t":"C"}]}
"帮我查天气" → {"i":[{"t":"N","n":"天气"}]}
严禁输出 markdown，直接输出纯 JSON。` }
    ];
    
    const testInput = '你好';
    
    console.log('🔬 Prompt Length Impact Analysis');
    console.log('='.repeat(60));
    
    for (const model of models) {
        console.log(`\n🧪 Model: ${model}`);
        console.log('-'.repeat(40));
        
        for (const prompt of prompts) {
            const start = Date.now();
            let ttft = 0;
            let content = '';
            
            try {
                const params: any = {
                    model,
                    messages: [
                        { role: 'system', content: prompt.content },
                        { role: 'user', content: testInput }
                    ],
                    max_tokens: 30,
                    temperature: 0,
                    stream: true,
                    response_format: { type: 'json_object' }
                };
                if (model.includes('qwen3')) {
                    params.enable_thinking = false;
                }
                
                const stream = await openai.chat.completions.create(params as any) as any;
                
                let firstChunk = true;
                for await (const chunk of stream) {
                    if (firstChunk) {
                        ttft = Date.now() - start;
                        firstChunk = false;
                    }
                    content += chunk.choices?.[0]?.delta?.content || '';
                }
                const total = Date.now() - start;
                
                console.log(`[${prompt.name}] TTFT=${ttft}ms, 总=${total}ms`);
            } catch (e: any) {
                console.log(`[${prompt.name}] ❌ Error: ${e.message.slice(0, 80)}`);
            }
            
            await new Promise(r => setTimeout(r, 300));
        }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 关键发现');
    console.log('='.repeat(60));
    console.log('预期: Prompt越长 → TTFT越高（因为KV Cache预填充耗时增加）');
    console.log('观察: 不同模型对Prompt长度的敏感度可能不同');
}

analyzePromptLengthImpact().catch(console.error);
