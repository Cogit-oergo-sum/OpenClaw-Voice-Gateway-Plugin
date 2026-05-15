import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

/**
 * 探查百炼 API 的内部行为差异
 */

async function probeApiBehavior() {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    
    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    
    // 测试不同的请求参数组合
    console.log('🔬 API Behavior Probe');
    console.log('='.repeat(60));
    
    const testCases = [
        { name: '无 response_format', params: { model: 'qwen-turbo', messages: [{role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true } },
        { name: '有 response_format', params: { model: 'qwen-turbo', messages: [{role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' } } },
        { name: '有 system prompt', params: { model: 'qwen-turbo', messages: [{role:'system',content:'输出JSON'}, {role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' } } },
        { name: '长 system prompt', params: { model: 'qwen-turbo', messages: [{role:'system',content:`[规则]1.闲聊→{"i":[]}2.任务→{"i":[{"t":"N"}]}示例:"你好"→{"i":[]}`}, {role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' } } },
    ];
    
    for (const test of testCases) {
        const start = Date.now();
        let ttft = 0;
        let content = '';
        
        try {
            const stream = await openai.chat.completions.create(test.params as any) as any;
            let firstChunk = true;
            for await (const chunk of stream) {
                if (firstChunk) {
                    ttft = Date.now() - start;
                    firstChunk = false;
                }
                content += chunk.choices?.[0]?.delta?.content || '';
            }
            const total = Date.now() - start;
            console.log(`[${test.name}] TTFT=${ttft}ms, 总=${total}ms, 输出="${content.slice(0,30)}"`);
        } catch (e: any) {
            console.log(`[${test.name}] ❌ ${e.message.slice(0, 60)}`);
        }
        
        await new Promise(r => setTimeout(r, 400));
    }
    
    // 测试 qwen3-8b 同样参数
    console.log('\n🧪 qwen3-8b 对比');
    console.log('-'.repeat(40));
    
    const testCases3 = [
        { name: '无 response_format', params: { model: 'qwen3-8b', messages: [{role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, enable_thinking: false } },
        { name: '有 response_format', params: { model: 'qwen3-8b', messages: [{role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' }, enable_thinking: false } },
        { name: '有 system prompt', params: { model: 'qwen3-8b', messages: [{role:'system',content:'输出JSON'}, {role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' }, enable_thinking: false } },
        { name: '长 system prompt', params: { model: 'qwen3-8b', messages: [{role:'system',content:`[规则]1.闲聊→{"i":[]}2.任务→{"i":[{"t":"N"}]}示例:"你好"→{"i":[]}`}, {role:'user',content:'你好'}], max_tokens: 10, temperature: 0, stream: true, response_format: { type: 'json_object' }, enable_thinking: false } },
    ];
    
    for (const test of testCases3) {
        const start = Date.now();
        let ttft = 0;
        let content = '';
        
        try {
            const stream = await openai.chat.completions.create(test.params as any) as any;
            let firstChunk = true;
            for await (const chunk of stream) {
                if (firstChunk) {
                    ttft = Date.now() - start;
                    firstChunk = false;
                }
                content += chunk.choices?.[0]?.delta?.content || '';
            }
            const total = Date.now() - start;
            console.log(`[${test.name}] TTFT=${ttft}ms, 总=${total}ms, 输出="${content.slice(0,30)}"`);
        } catch (e: any) {
            console.log(`[${test.name}] ❌ ${e.message.slice(0, 60)}`);
        }
        
        await new Promise(r => setTimeout(r, 400));
    }
    
    console.log('\n📊 分析');
    console.log('='.repeat(60));
}

probeApiBehavior().catch(console.error);
