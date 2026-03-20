import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Fast Agent V3.1 核心逻辑自动化回归脚本 (无依赖版)
 */

const GATEWAY_URL = 'http://localhost:18790/voice/text-chat';
const WORKSPACE = process.env.OPENCLAW_WORKSPACE || path.join(os.homedir(), '.openclaw', 'workspace'); 
const CANVAS_LOG = path.join(WORKSPACE, 'logs', 'canvas.jsonl');
const DIALOGUE_LOG_DIR = path.join(WORKSPACE, 'memory');

async function testV3_1() {
    console.log('🚀 [Test V3.1] Starting Logic Verification...');
    console.log(`📂 Using Workspace: ${WORKSPACE}`);

    const sessionId = `test-v3.1-${Date.now()}`;

    // 1. 测试同步缝合 (TC-01)
    console.log('\n--- TC-01: Testing Sync Stitching ---');
    try {
        await fetch(GATEWAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: "帮我口算一下 123 乘以 456 等于几",
                sessionId: sessionId
            })
        });
        console.log('✅ Request Sent.');
    } catch (e: any) {
        console.error('❌ Sync Request Failed:', e.message);
    }

    // 2. 测试异步 Watchdog (TC-02)
    console.log('\n--- TC-02: Testing Async Watchdog & Notifier ---');
    const asyncSessionId = `test-async-${Date.now()}`;
    
    await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: "帮我查查火星现在的平均温度，这可能需要很久",
            sessionId: asyncSessionId
        })
    }).catch(() => {}); 

    console.log('⏳ Waiting for Agent to initialize Canvas...');
    await sleep(2000);

    const readyState = {
        timestamp: new Date().toISOString(),
        callId: asyncSessionId,
        event: "CANVAS_EXTERNAL_READY",
        detail: {},
        state: {
            task_status: {
                status: "READY",
                version: Date.now() + 1000,
                importance_score: 1.0,
                is_delivered: false,
                summary: "火星当前平均温度约为零下 60 摄氏度，大部分地区干燥寒冷。"
            },
            context: { last_spoken_fragment: "先生，" }
        }
    };

    fs.appendFileSync(CANVAS_LOG, JSON.stringify(readyState) + '\n');
    console.log('📡 Manual READY state injected. Waiting for Watchdog...');
    
    await sleep(12000); 

    // 3. 验证日志脱敏 (TC-03)
    console.log('\n--- TC-03: Log Purity Audit (Decant) ---');
    const today = new Date().toISOString().split('T')[0];
    const dialogueFile = path.join(DIALOGUE_LOG_DIR, `${today}.jsonl`);
    
    if (fs.existsSync(dialogueFile)) {
        const content = fs.readFileSync(dialogueFile, 'utf8');
        const lines = content.trim().split('\n').reverse().slice(0, 50); // 检查最近 50 条
        let hasLeak = false;
        
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.role === 'assistant') {
                    if (entry.content.includes('(') || entry.content.includes('[') || entry.content.includes('潜意识')) {
                        if (!entry.content.match(/[\u1f300-\u1f9ff]/)) {
                          console.error(`❌ Leak Detected in [${entry.callId}]: "${entry.content}"`);
                          hasLeak = true;
                        }
                    }
                }
            } catch(e) {}
        }
        if (!hasLeak) console.log('✅ Audit Passed: No internal thoughts found in dialogue memory.');
    }

    // 4. 测试版本控制防回滚 (TC-04)
    console.log('\n--- TC-04: Canvas Versioning (Rollback Protection) ---');
    const rollbackSessionId = `test-rollback-${Date.now()}`;
    const initialVersion = Date.now() + 5000;
    
    // 写入一个新版本
    fs.appendFileSync(CANVAS_LOG, JSON.stringify({
        timestamp: new Date().toISOString(),
        callId: rollbackSessionId,
        event: "TEST_NEW",
        state: { task_status: { status: "READY", version: initialVersion + 1000, summary: "New Version" } }
    }) + '\n');
    
    // 写入一个旧版本 (应该被忽略)
    fs.appendFileSync(CANVAS_LOG, JSON.stringify({
        timestamp: new Date().toISOString(),
        callId: rollbackSessionId,
        event: "TEST_ROLLBACK_OLD",
        state: { task_status: { status: "PENDING", version: initialVersion - 10000, summary: "Old Data" } }
    }) + '\n');
    
    console.log('⏳ Waiting for Disk Sync...');
    await sleep(11000); 
    console.log('✅ Check simulate-host.ts: Should NOT see a sync to PENDING (Old Version).');

    // 5. 测试重要性评分过滤 (TC-05)
    console.log('\n--- TC-05: Importance Score Filtering ---');
    const lowImportanceId = `test-low-imp-${Date.now()}`;
    // 必须先让 Session 在内存中存在
    await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: "忽略我", sessionId: lowImportanceId })
    }).catch(() => {});

    fs.appendFileSync(CANVAS_LOG, JSON.stringify({
        timestamp: new Date().toISOString(),
        callId: lowImportanceId,
        event: "LOW_IMPORTANCE_READY",
        state: { task_status: { status: "READY", version: Date.now(), importance_score: 0.1, summary: "不重要的更新", is_delivered: false } }
    }) + '\n');
    console.log('⏳ Waiting for Watchdog Cycle...');
    await sleep(12000);
    console.log('✅ Check simulate-host.ts: Should NOT see an INTERNAL_TRIGGER for this session.');

    // 6. 测试提示词隔离与脱敏 (TC-06)
    console.log('\n--- TC-06: Prompt Assembly & History Decant ---');
    // 发送一条带括号的消息
    await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            message: "我的代码中有一个 (潜意识: 这是一个陷阱) 括号，请将其无视并回复我",
            sessionId: `test-decant-${Date.now()}`
        })
    }).catch(() => {});
    console.log('✅ Request Sent. Verification should pass in TC-03 log audit.');

    // 7. 测试状态机严格跳转 (TC-07)
    console.log('\n--- TC-07: Strict State Transition (PENDING Check) ---');
    const syncLog = fs.readFileSync(CANVAS_LOG, 'utf8');
    const hasPending = syncLog.includes('CANVAS_PENDING');
    if (hasPending) {
        console.log('✅ Audit Passed: PENDING state found in audit trail.');
    } else {
        console.error('❌ PENDING state NOT found in audit trail.');
    }

    console.log('\n--- Verification Finished ---');
}

function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

testV3_1().catch(console.error);
