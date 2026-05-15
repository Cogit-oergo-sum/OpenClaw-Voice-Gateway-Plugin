import * as dotenv from 'dotenv';
import OpenAI from 'openai';

dotenv.config();

/**
 * 分析 KV Cache 效果：相同 Prompt 多次调用
 */

async function analyzeCacheEffect() {
    const apiKey = process.env.BAILIAN_API_KEY || '';
    const baseUrl = process.env.BAILIAN_BASE_URL || '';
    
    const openai = new OpenAI({ apiKey, baseURL: baseUrl });
    
    // 固定的 system prompt（模拟真实的路由 Prompt）
    const systemPrompt = `[Intent Router]
判断用户意图并输出 JSON：
- 纯闲聊 → {"i":[]}
- 新任务 → {"i":[{"t":"N","n":"<任务名>"}]}
示例:"你好"→{"i":[]}
严禁 markdown。`;
    
    console.log('🔬 KV Cache Effect Analysis (多次调用相同 Prompt)');
    console.log('='.repeat(60));
    
    const models = ['qwen-turbo', 'qwen3-8b'];
    
    for (const model of models) {
        console.log(`\n🧪 Model: ${model}`);
        console.log('-'.repeat(40));
        
        // 连续调用 5 次，观察延迟变化
        for (let i = 1; i <= 5; i++) {
            const start = Date.now();
            let ttft = 0;
            let content = '';
            
            try {
                const params: any = {
                    model,
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: '你好' }
                    ],
                    max_tokens: 20,
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
                
                // 分析是否有缓存效果
                const cacheIndicator = i === 1 ? '(首次)' : (ttft < 200 ? '(缓存命中?)' : '');
                console.log(`  第${i}次: TTFT=${ttft}ms, 总=${total}ms ${cacheIndicator}`);
            } catch (e: any) {
                console.log(`  第${i}次: ❌ ${e.message.slice(0, 50)}`);
            }
            
            // 短间隔
            await new Promise(r => setTimeout(r, 200));
        }
        
        // 长间隔后再调用
        console.log('\n  等待 3 秒后再次调用...');
        await new Promise(r => setTimeout(r, 3000));
        
        const start = Date.now();
        let ttft = 0;
        let content = '';
        
        try {
            const params: any = {
                model,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: '你好' }
                ],
                max_tokens: 20,
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
            console.log(`  延迟调用: TTFT=${ttft}ms, 总=${total}ms`);
        } catch (e: any) {
            console.log(`  延迟调用: ❌ ${e.message.slice(0, 50)}`);
        }
    }
    
    console.log('\n📊 分析');
    console.log('='.repeat(60));
    console.log('预期: 如果 KV Cache 有效，后续调用 TTFT 应显著降低');
    console.log('观察: 不同模型的缓存机制可能不同');
}

analyzeCacheEffect().catch(console.error);
