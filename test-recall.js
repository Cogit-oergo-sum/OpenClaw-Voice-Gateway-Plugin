
async function test() {
    console.log('--- Phase 3: Long-term Memory recall ---');
    try {
        const res = await fetch('http://127.0.0.1:18790/voice/text-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: 'Jarvis，我是谁？我刚才跟你说过我喜欢喝什么吗？', 
                sessionId: 'recall-test-' + Date.now() 
            }),
            signal: AbortSignal.timeout(60000)
        });
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split('\n\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(line.replace('data: ', ''));
                        if (json.content) process.stdout.write(json.content);
                    } catch(e) {}
                }
            }
        }
        console.log('\n[Result] Done.');
    } catch (err) {
        console.error('[Error]', err.message);
    }
}
test();
