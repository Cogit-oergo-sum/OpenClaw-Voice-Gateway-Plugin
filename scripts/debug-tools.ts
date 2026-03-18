import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const client = new OpenAI({
        apiKey: process.env.BAILIAN_API_KEY,
        baseURL: process.env.BAILIAN_BASE_URL
    });

    console.log('Testing TOOLS with qwen-plus...');

    try {
        const response = await client.chat.completions.create({
            model: 'qwen-plus',
            messages: [{ role: 'user', content: 'hi' }],
            tools: [
                {
                    type: 'function',
                    function: {
                        name: 'test_tool',
                        description: 'A test tool',
                        parameters: { type: 'object', properties: {} }
                    }
                }
            ],
            max_tokens: 5
        });
        console.log('qwen-plus with tools works!');
    } catch (e: any) {
        console.error('qwen-plus with tools FAILED:', e.message);
        console.error('Full Error:', JSON.stringify(e));
    }
}

test();
