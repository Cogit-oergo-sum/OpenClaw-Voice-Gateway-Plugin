
const SESSION_ID = 'test-session-' + Date.now();

async function chat(message) {
    console.log(`\nUser: ${message}`);
    const response = await fetch(`http://127.0.0.1:18790/voice/text-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, sessionId: SESSION_ID })
    });
    
    if (!response.body) return;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullContent = '';

    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
            if (line.startsWith('data: ')) {
                const dataStr = line.replace('data: ', '').trim();
                if (dataStr === '[DONE]') continue;
                try {
                    const data = JSON.parse(dataStr);
                    if (data.type === 'text' || data.type === 'filler') {
                        process.stdout.write(data.content);
                        fullContent += data.content;
                    }
                } catch (e) {}
            }
        }
    }
    console.log('\n--- End of turn ---');
    return fullContent;
}

async function runTest() {
    console.log('--- Testing Memory ---');
    await chat('你好，我叫 Rhettbot。记住我的名字。');
    await chat('我刚才说我叫什么？');

    console.log('\n--- Testing Tool Calling ---');
    await chat('请帮我看一下当前目录下的 agent.md 文件内容，告诉我它说了什么。');
}

runTest().catch(console.error);
