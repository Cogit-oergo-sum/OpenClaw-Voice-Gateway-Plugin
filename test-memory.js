
async function test() {
    console.log('--- Phase 1: Identity & Memory Test ---');
    try {
        const res = await fetch('http://127.0.0.1:18790/voice/text-chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                message: 'Jarvis，记一下，我叫李雷，我喜欢喝冰美式。', 
                sessionId: 'user-memory-test-' + Date.now() 
            }),
            signal: AbortSignal.timeout(30000)
        });
        
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let reply = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            const text = decoder.decode(value);
            const lines = text.split('\n\n');
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const json = JSON.parse(line.replace('data: ', ''));
                        if (json.content) {
                            process.stdout.write(json.content);
                            reply += json.content;
                        }
                    } catch(e) {}
                }
            }
        }
        console.log('\n[Result] Reply received.');
    } catch (err) {
        console.error('[Error]', err.message);
    }
}
test();
