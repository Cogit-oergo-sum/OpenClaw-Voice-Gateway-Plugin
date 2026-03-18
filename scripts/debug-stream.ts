import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const client = new OpenAI({
        apiKey: process.env.BAILIAN_API_KEY,
        baseURL: process.env.BAILIAN_BASE_URL
    });

    console.log('Testing STREAMING with qwen-plus...');

    try {
        const stream = await client.chat.completions.create({
            model: 'qwen-plus',
            messages: [{ role: 'user', content: 'hi' }],
            stream: true
        });
        
        for await (const chunk of stream) {
            process.stdout.write(chunk.choices[0]?.delta?.content || '');
        }
        console.log('\nStreaming works!');
    } catch (e: any) {
        console.error('Streaming failed:', e.message);
    }
}

test();
