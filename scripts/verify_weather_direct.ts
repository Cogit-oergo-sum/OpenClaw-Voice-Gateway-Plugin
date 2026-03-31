import { DelegateExecutor } from '../src/agent/executor';
import * as path from 'path';

/**
 * [V3.6.2] Weather Tool Verification (Relaxed Timeout)
 * 职责：深度验证 DelegateExecutor 调用 OpenClaw 执行天气查询。
 */
async function verifyWeatherTool() {
    console.log('🚀 Starting Weather Tool Verification (60s Timeout)...\n');

    const workspaceRoot = '/Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-test-env/workspace';
    const executor = new DelegateExecutor(workspaceRoot);
    const callId = 'weather-test-' + Date.now();
    const intent = '查询深圳今天的天气。';

    console.log(`[Test] Calling OpenClaw Agent with intent: "${intent}"...`);
    try {
        // [V3.6.2] 使用更长的超时时间来覆盖 Docker 容器内部 LLM 的预热/生成耗时
        const result = await executor.executeOpenClaw(callId, intent, 60000); 
        
        console.log('\n--- Result stdout ---');
        console.log(result.stdout || '(Empty)');
        console.log('--- End Result ---\n');

        if (result.stdout.includes('计') || result.stdout.includes('℃') || result.stdout.toLowerCase().includes('weather') || result.stdout.includes('晴') || result.stdout.includes('雨')) {
            console.log('✅ Success: Received weather-like information from OpenClaw.');
        } else {
            console.log('⚠️ Warning: Result received but may not contain expected weather data. Check stdout.');
        }

        if (result.isTimeout) {
            console.log('❌ Error: Task reached the race timeout (60s).');
        } else {
            console.log('✅ Success: Tool executed and returned.');
        }

    } catch (e: any) {
        console.error('❌ Execution crashed:', e.message);
    }
}

verifyWeatherTool().catch(e => {
    console.error('❌ Script failure:', e);
    process.exit(1);
});
