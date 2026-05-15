import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

/**
 * 深度分析模型延迟差异的原因
 */

async function analyzeModelLatency() {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    
    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    
    const models = ['qwen-turbo', 'qwen3-8b', 'qwen3-14b'];
    
    // 简单 Prompt 测试
    const simplePrompt = '输出 JSON: {"i":[]} 如果闲聊。NO markdown.';
    const testInput = '你好';
    
    console.log('🔬 Deep Latency Analysis');
    console.log('='.repeat(60));
    
    for (const model of models) {
        console.log(`\n🧪 Model: ${model}`);
        
        // 测试 1: 非 stream
        console.log('\n[非流式模式]');
        const start1 = Date.now();
        try {
            const params1: any = {
                model,
                messages: [{ role: 'user', content: testInput }],
                max_tokens: 20,
                temperature: 0
            };
            if (model.includes('qwen3')) {
                params1.enable_thinking = false;
            }
            
            const resp1 = await openai.chat.completions.create(params1);
            const latency1 = Date.now() - start1;
            const tokens1 = resp1.usage;
            console.log(`   延迟: ${latency1}ms`);
            console.log(`   Token统计: prompt=${tokens1?.prompt_tokens}, completion=${tokens1?.completion_tokens}, total=${tokens1?.total_tokens}`);
            console.log(`   输出: ${resp1.choices[0]?.message?.content?.slice(0, 50)}`);
        } catch (e: any) {
            console.log(`   ❌ Error: ${e.message}`);
        }
        
        // 测试 2: stream
        console.log('\n[流式模式]');
        const start2 = Date.now();
        let ttft = 0;
        let content = '';
        try {
            const params2: any = {
                model,
                messages: [{ role: 'user', content: testInput }],
                max_tokens: 20,
                temperature: 0,
                stream: true
            };
            if (model.includes('qwen3')) {
                params2.enable_thinking = false;
            }
            
            const stream = await openai.chat.completions.create(params2 as any) as any;
            
            let firstChunk = true;
            for await (const chunk of stream) {
                if (firstChunk) {
                    ttft = Date.now() - start2;
                    firstChunk = false;
                }
                content += chunk.choices?.[0]?.delta?.content || '';
            }
            const totalLatency = Date.now() - start2;
            
            console.log(`   TTFT (首字): ${ttft}ms`);
            console.log(`   总延迟: ${totalLatency}ms`);
            console.log(`   输出: ${content.slice(0, 50)}`);
        } catch (e: any) {
            console.log(`   ❌ Error: ${e.message}`);
        }
        
        await new Promise(r => setTimeout(r, 500)); // 防止限流
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 分析结论');
    console.log('='.repeat(60));
}

analyzeModelLatency().catch(console.error);
