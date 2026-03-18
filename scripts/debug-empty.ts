import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const client = new OpenAI({
        apiKey: process.env.BAILIAN_API_KEY,
        baseURL: process.env.BAILIAN_BASE_URL
    });

    console.log('Testing EMPTY ASSISTANT CONTENT with qwen-plus...');

    try {
        const response = await client.chat.completions.create({
            model: 'qwen-plus',
            messages: [
                { role: 'user', content: 'hi' },
                { role: 'assistant', content: '' }
            ],
            stream: false
        });
        console.log('Empty assistant content works!');
    } catch (e: any) {
        console.error('Empty assistant content failed:', e.message);
    }
}

test();
