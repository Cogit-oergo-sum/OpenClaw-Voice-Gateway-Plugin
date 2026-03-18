import OpenAI from 'openai';
import * as dotenv from 'dotenv';
dotenv.config();

async function test() {
    const client = new OpenAI({
        apiKey: process.env.BAILIAN_API_KEY,
        baseURL: process.env.BAILIAN_BASE_URL
    });

    console.log('Testing with API Key:', process.env.BAILIAN_API_KEY?.substring(0, 8) + '...');
    console.log('Using URL:', process.env.BAILIAN_BASE_URL);

    try {
        const response = await client.chat.completions.create({
            model: 'qwen-turbo',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5
        });
        console.log('qwen-turbo works!');
    } catch (e: any) {
        console.error('qwen-turbo failed:', e.message);
    }

    try {
        const response = await client.chat.completions.create({
            model: 'qwen-plus',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 5
        });
        console.log('qwen-plus works!');
    } catch (e: any) {
        console.error('qwen-plus failed:', e.message);
    }
}

test();
