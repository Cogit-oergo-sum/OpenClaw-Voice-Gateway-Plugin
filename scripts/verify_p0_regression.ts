import { FastAgentFactory } from '../src/agent/factory';
import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { callContextStorage } from '../src/context/ctx';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

dotenv.config();

/**
 * OpenClaw P0 Regression Runner (V3.6.4+)
 * 验证重点：
 * 1. 历史净化 (Flat History in DECIDING)
 * 2. 意图改写 (Implicit Entity Extraction)
 * 3. 真实联动 (Docker Container Execution)
 * 4. 异步心跳 (Watchdog Async Result)
 */

const LOG_FILE = path.join(process.cwd(), '.llm_requests.log');
const WORKSPACE_IN_DOCKER = '/root/openclaw/workspace'; // 默认路径

async function runRegression() {
    console.log('\x1b[36m%s\x1b[0m', '--- 🧪 OpenClaw P0 Regression Test: Detailed Audit ---');
    
    // 1. 物理环境对齐 (V3.6.24)
    try {
        console.log('🔄 Aligning environment with ./ctl.sh restart...');
        execSync('./ctl.sh restart');
        console.log('🧹 Killing container-side logic to ensure exclusive audit...');
        execSync('docker exec openclaw_voice_test pkill openclaw || true');
    } catch (e: any) {
        console.error('❌ Critical: Failed to align environment.', e.message);
        process.exit(1);
    }

    const config = {
        llm: { provider: 'bailian', apiKey: process.env.BAILIAN_API_KEY, baseUrl: process.env.BAILIAN_BASE_URL, model: process.env.BAILIAN_MODEL || 'qwen-plus' },
        fastAgent: { slcModel: process.env.SLC_MODEL || 'qwen-turbo', slcBaseUrl: process.env.SLC_BASE_URL || process.env.BAILIAN_BASE_URL, sleModel: process.env.BAILIAN_MODEL || 'qwen-plus', sleBaseUrl: process.env.BAILIAN_BASE_URL },
        zego: { appId: Number(process.env.ZEGO_APP_ID), serverSecret: process.env.ZEGO_SERVER_SECRET, aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL }
    };

    const workspaceRoot = process.env.OPENCLAW_WORKSPACE || path.join(__dirname, '..');
    const agent = FastAgentFactory.create(config as any, workspaceRoot);
    const callId = `reg-p0-${Date.now()}`;
    const results: any[] = [];

    // 2. 执行测试序列
    const testMdFile = `test_hallucination_${Date.now()}.md`;
    const testMdContent = `Verification Secret: ${Math.random().toString(36).substring(7)}`;
    
    // 初始化测试文件到容器
    console.log(`\n[Prep] Creating ground truth file in docker: ${testMdFile}`);
    execSync(`docker exec openclaw_voice_test sh -c "echo '${testMdContent}' > /app/workspace/${testMdFile}"`);

    const steps = [
        { id: 'S1', input: '你好。', goal: 'Verify chat & prompt cleanup' },
        { id: 'S2', input: '今天啥日子？', goal: 'Verify Canvas context injection' },
        { id: 'S3', input: '查询下深圳今天的天气', goal: 'Verify Native Tool & Intent Rewrite' },
        { id: 'S4', input: `在我的工作区创建一个 reg_test_${callId}.txt 的文件，内容写 "RegSuccess"`, goal: 'Verify Docker Execution' },
        { id: 'S5', input: `看看 ${testMdFile} 是否存在？`, goal: 'Verify File Existence Perception' },
        { id: 'S6', input: `${testMdFile} 里具体写了什么内容？`, goal: 'Verify Anti-Hallucination (Content Match)' }
    ];

    const mockNotifier = async (text: string, trace?: string[]) => {
        console.log(`\n\x1b[35m[Mock Notifier] Proactive Broadcast: "${text}"\x1b[0m`);
    };

    const stepResponses: Record<string, string> = {};

    for (const step of steps) {
        console.log(`\n[${step.id}] Sending: "${step.input}"`);
        let slcResponse = "";
        
        // [V3.6.4] 重试逻辑：如果会话被锁（例如正在后台提纯或 Watchdog 回报），则等待 3s 后重试
        let tryCount = 0;
        while(AgentOrchestrator.isLocked(callId) && tryCount < 5) {
            console.log(`  Waiting for session lock to clear... (trial ${tryCount+1}/5)`);
            await new Promise(r => setTimeout(r, 2000));
            tryCount++;
        }

        await callContextStorage.run({ callId, userId: 'test-user', startTime: Date.now(), metadata: {} }, async () => {
            // [V3.6.10] 注入 mockNotifier 以确保 Watchdog 能够命中并触发 trigger 事件
            await agent.process(step.input, (chunk) => {
                if (chunk.content) slcResponse += chunk.content;
            }, mockNotifier);
        });
        stepResponses[step.id] = slcResponse;
        console.log(`  > Response: ${slcResponse.substring(0, 80)}...`);
        await new Promise(r => setTimeout(r, 10000)); // 增加等待时间，确保底层工具链异步闭环
    }

    console.log('\n[S7] Waiting 15s for Watchdog/Idle trigger (Final Sync)...');
    await new Promise(r => setTimeout(r, 15000));

    // 3. 详细审计报告 (Evidence-Driven)
    console.log('\n\x1b[36m%s\x1b[0m', '--- 📑 Detailed Evidence Audit ---');

    const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l.trim()).map(l => ({ ...JSON.parse(l), raw: l })).filter(l => l.callId === callId);

    // [A] 历史净化验证
    const decidingLogs = logs.filter(l => l.scenario === 'DECIDING');
    const historyEvidence = decidingLogs.map(l => {
        const hasDirectHistory = l.request.find((m: any) => m.content.includes('[Recent History]'));
        const hasAssistantMsg = l.request.some((m: any) => m.role === 'assistant');
        return hasDirectHistory && !hasAssistantMsg;
    });
    const historyPass = historyEvidence.length > 0 && historyEvidence.every(v => v);
    results.push({
        Step: 'Audit: History', Status: historyPass ? 'PASS' : 'FAIL',
        Data: `turns=${decidingLogs.length}`,
        Strategy: 'Parsed DECIDING log. Verified role:"assistant" count is 0 and history is flattened in user message.'
    });

    // [B] 意图改写验证
    const weatherLog = decidingLogs.find(l => l.request.some((m: any) => m.content.includes('天气')));
    const intentMatch = weatherLog?.response?.includes('weather_mcp');
    results.push({
        Step: 'Audit: Intent', Status: intentMatch ? 'PASS' : 'FAIL',
        Data: `found_mcp=${!!intentMatch}`,
        Strategy: 'Audited SLE response JSON. Verified "weather_mcp" tool_call exists for weather query.'
    });

    // [C] 物理执行验证 (Docker)
    const testFile = `reg_test_${callId}.txt`;
    let fileVerified = false;
    let fileContent = "";
    try {
        const findOut = execSync(`docker exec openclaw_voice_test find /app/workspace -name "${testFile}"`).toString().trim();
        if (findOut) {
            fileVerified = true;
            fileContent = execSync(`docker exec openclaw_voice_test cat ${findOut}`).toString().trim();
        }
    } catch (e) {}
    results.push({
        Step: 'Check: Docker', Status: (fileVerified && fileContent === 'RegSuccess') ? 'PASS' : 'FAIL',
        Data: `file=${fileVerified}, content="${fileContent}"`,
        Strategy: 'Executed "docker exec find" and "cat". Verified file existence and content match "RegSuccess".'
    });

    // [D] 反幻觉验证 (Existence)
    const existenceResponse = stepResponses['S5'] || "";
    const existencePass = existenceResponse.includes('存在') || existenceResponse.toLowerCase().includes('exist');
    results.push({
        Step: 'Hallucination: Exist', Status: existencePass ? 'PASS' : 'FAIL',
        Data: `res="${existenceResponse.substring(0, 20)}..."`,
        Strategy: `Verified S5 response confirms existence of ${testMdFile}.`
    });

    // [E] 反幻觉验证 (Content Match)
    const contentPass = logs.some(l => 
        (l.scenario === 'SLC_CHAT' || l.source === 'Async-Result-Delivery') && 
        l.response?.includes(testMdContent.split(':')[1].trim())
    );
    results.push({
        Step: 'Hallucination: Content', Status: contentPass ? 'PASS' : 'FAIL',
        Data: `match=${contentPass}`,
        Strategy: `Audited full logs (including Async replies). Verified secret "${testMdContent}" exists in AI responses.`
    });

    // [F] 异步播报验证
    const watchdogLog = logs.find(l => l.source === 'Async-Result-Delivery' || l.source === 'Watchdog-Idle');
    results.push({
        Step: 'Check: Watchdog', Status: !!watchdogLog ? 'PASS' : 'FAIL',
        Data: `source="${watchdogLog?.source || 'NONE'}"`,
        Strategy: 'Scanned logs for proactive sources. Verified Watchdog triggered Async-Result-Delivery.'
    });

    console.table(results);

    // 4. 清理 (Robust)
    console.log('\n--- 🧹 Robust Cleanup ---');
    try {
        execSync(`docker exec openclaw_voice_test rm -f /app/workspace/${testMdFile}`);
        const cleanupPath = execSync(`docker exec openclaw_voice_test find /app/workspace -name "${testFile}"`).toString().trim();
        if (cleanupPath) execSync(`docker exec openclaw_voice_test rm -f ${cleanupPath}`);
        console.log(`  Deleted docker files: ${testFile}, ${testMdFile}`);
    } catch (e) {}
    
    await agent.destroySession(callId);
    console.log(`  Cleaned local session memory: ${callId}`);
    
    const finalAllPass = results.every(r => r.Status === 'PASS');
    console.log(`\nFinal Consensus: ${finalAllPass ? '✅ SUCCESS' : '❌ FAILED'}`);
    process.exit(finalAllPass ? 0 : 1);
}

runRegression().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
