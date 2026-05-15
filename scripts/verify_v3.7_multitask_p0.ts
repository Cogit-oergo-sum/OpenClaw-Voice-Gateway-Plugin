import { FastAgentFactory } from '../src/agent/factory';
import { AgentOrchestrator } from '../src/agent/agent-orchestrator';
import { callContextStorage } from '../src/context/ctx';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

dotenv.config();

/**
 * OpenClaw V3.7 Multitask P0 Regression Runner
 */

const LOG_FILE = path.join(process.cwd(), '.llm_requests.log');
const SNAPSHOT_FILE = path.join(process.cwd(), 'logs/canvas_snapshot.json');
const CANVAS_JSONL_LOG_FILE = path.join(process.cwd(), 'logs/canvas.jsonl');
const date = new Date().toISOString().split('T')[0];
const MEMORY_JSONL_LOG_FILE = path.join(process.cwd(), `memory/${date}.jsonl`);

async function runRegression() {
    console.log('\x1b[36m%s\x1b[0m', '--- 🧪 OpenClaw V3.7 Multitask P0 Regression Audit ---');
    
    // 1. 环境初始化
    try {
        console.log('🔄 Cleaning and Restarting environment...');
        execSync('./ctl.sh restart');
    } catch (e: any) {
        console.error('❌ Critical: Failed to restart environment.', e.message);
        process.exit(1);
    }

    const config = {
        llm: { provider: 'bailian', apiKey: process.env.BAILIAN_API_KEY, baseUrl: process.env.BAILIAN_BASE_URL, model: process.env.BAILIAN_MODEL || 'qwen-plus' },
        fastAgent: { slcModel: process.env.SLC_MODEL || 'qwen-turbo', slcBaseUrl: process.env.SLC_BASE_URL || process.env.BAILIAN_BASE_URL, sleModel: process.env.BAILIAN_MODEL || 'qwen-plus', sleBaseUrl: process.env.BAILIAN_BASE_URL },
        zego: { appId: Number(process.env.ZEGO_APP_ID), serverSecret: process.env.ZEGO_SERVER_SECRET, aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL }
    };

    const workspaceRoot = process.env.OPENCLAW_WORKSPACE || path.join(__dirname, '..');
    const agent = FastAgentFactory.create(config as any, workspaceRoot);
    const callId = `reg-37-${Date.now()}`;
    const results: any[] = [];

    const mockNotifier = async (text: string, trace?: string[]) => {
        console.log(`\n\x1b[35m[Mock Notifier] Proactive Broadcast: "${text}"\x1b[0m`);
    };

    // --- TEST 1: NEW_TASK && Router Protocol ---
    console.log('\n[T1] Test: Multitask Intent Routing');
    await callContextStorage.run({ callId, userId: 'test-user', startTime: Date.now(), metadata: {} }, async () => {
        await agent.process('帮我查询深圳的天气，顺便帮我查询北京的天气，这是两个独立任务', (chunk) => {}, mockNotifier);
    });
    
    // 审计结果 1 & 2
    await new Promise(r => setTimeout(r, 2000));
    const logs = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(l => l.callId === callId);
    
    const routingLog = logs.find(l => l.scenario === 'ROUTING');
    let hasIntentsArray = false;
    try {
        const parsedResponse = JSON.parse(routingLog?.response || '{}');
        hasIntentsArray = Array.isArray(parsedResponse.intents);
    } catch (e) {}
    results.push({ Step: 'Router JSON', Status: hasIntentsArray ? 'PASS' : 'FAIL', Strategy: 'Check response_raw for intents[] array' });

    const decidingLogs = logs.filter(l => l.scenario === 'DECIDING');
    results.push({ Step: 'Parallel Deciding', Status: decidingLogs.length >= 2 ? 'PASS' : 'FAIL', Data: `launched=${decidingLogs.length}`, Strategy: 'Verified if multiple SLE routes triggered parallel Deciding' });

    // 审计结果 3: DECIDING 隔离
    const isolationEvidence = decidingLogs.every(l => {
        const snapshotRaw = l.request.find((m: any) => m.content.includes('[Focused Task Snapshot]:'))?.content;
        if (!snapshotRaw) return false;
        const taskMatches = snapshotRaw.match(/任务: /g);
        return taskMatches && taskMatches.length === 1; // 应该只看到一个任务（自身）
    });
    // 注意：如果模型返回的是两个并行任务，orchestrator 每个 runTask 只传 [task]，如果是依赖则传 [A, B]
    results.push({ Step: 'DECIDING Isolation', Status: isolationEvidence ? 'PASS' : 'FAIL', Strategy: 'Checked if each SLE context only sees partial tasks' });

    // --- TEST 2: CANCEL_TASK ---
    console.log('\n[T2] Test: Task Cancellation');
    await callContextStorage.run({ callId, userId: 'test-user', startTime: Date.now(), metadata: {} }, async () => {
        await agent.process('那北京的天气不用查了', (chunk) => {}, mockNotifier);
    });
    await new Promise(r => setTimeout(r, 2000));
    
    const snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))[callId];
    const cancelledCount = snapshot.tasks.filter((t: any) => t.status === 'CANCELLED').length;
    results.push({ Step: 'CANCEL Task', Status: cancelledCount >= 1 ? 'PASS' : 'FAIL', Strategy: 'Checked if target task status became CANCELLED' });

    // --- TEST 3: Watchdog Aggregation ---
    console.log('\n[T3] Test: Watchdog Aggregation');
    // 模拟两个任务完成但未播报
    snapshot.tasks[0].status = 'COMPLETED';
    snapshot.tasks[0].is_delivered = false;
    snapshot.tasks[0].summary = '深圳天气晴朗';
    snapshot.tasks[0].completed_at = Date.now();
    snapshot.tasks[0].version = Date.now() + 1000;
    
    // 如果有第二个任务（未被取消的），设为完成
    if (snapshot.tasks[1] && snapshot.tasks[1].status !== 'CANCELLED') {
        snapshot.tasks[1].status = 'COMPLETED';
        snapshot.tasks[1].is_delivered = false;
        snapshot.tasks[1].summary = '北京天气多云';
        snapshot.tasks[1].completed_at = Date.now();
        snapshot.tasks[1].version = Date.now() + 1000;
    }
    
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ [callId]: snapshot }, null, 2));
    console.log('  Wait for Watchdog to scan (max 5s)...');
    await new Promise(r => setTimeout(r, 6000));
    
    const logsAfterAggregation = fs.readFileSync(LOG_FILE, 'utf8').split('\n').filter(l => l.trim()).map(l => JSON.parse(l)).filter(l => l.callId === callId);
    const aggLog = logsAfterAggregation.find(l => l.source === 'Async-Result-Delivery');
    results.push({ Step: 'Watchdog Aggregation', Status: !!aggLog ? 'PASS' : 'FAIL', Strategy: 'Verified if Watchdog picked up multiple completed tasks' });

    // --- TEST 4: GC Archiving ---
    console.log('\n[T4] Test: GC Archiving (TTL mock)');
    // 模拟任务已投递且过期
    snapshot.tasks.forEach((t: any) => t.version = Date.now() + 5000);
    snapshot.tasks[0].is_delivered = true;
    snapshot.tasks[0].status = 'COMPLETED'; // 确保是 COMPLETED
    snapshot.tasks[0].completed_at = Date.now() - (150 * 1000); // 2.5 min ago
    fs.writeFileSync(SNAPSHOT_FILE, JSON.stringify({ [callId]: snapshot }, null, 2));
    
    console.log('  Wait for Watchdog GC (max 5s)...');
    await new Promise(r => setTimeout(r, 6000));
    
    const snapshotAfterGC = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, 'utf8'))[callId];
    const archivedInJSONL = fs.existsSync(MEMORY_JSONL_LOG_FILE) && fs.readFileSync(MEMORY_JSONL_LOG_FILE, 'utf8').includes('TASK_ARCHIVED');
    results.push({ Step: 'GC Archiving', Status: (snapshotAfterGC.tasks.length < snapshot.tasks.length && archivedInJSONL) ? 'PASS' : 'FAIL', Strategy: 'Checked if tasks removed from snapshot and logged to jsonl' });

    console.log(JSON.stringify(results, null, 2));
    const allPass = results.every(r => r.Status === 'PASS');
    console.log(`\nFinal Consensus: ${allPass ? '✅ SUCCESS' : '❌ FAILED'}`);
    
    process.exit(allPass ? 0 : 1);
}

runRegression().catch(err => {
    console.error('Fatal Test Error:', err);
    process.exit(1);
});
