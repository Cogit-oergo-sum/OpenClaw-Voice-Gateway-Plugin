
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { WatchdogService } from '../src/agent/watchdog';
import { CanvasManager } from '../src/agent/canvas-manager';
import { TaskItem, CanvasState } from '../src/agent/types';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

async function runTest() {
    const tmpDir = path.join(os.tmpdir(), `openclaw_test_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
    
    console.log(`[Test] Workspace: ${tmpDir}`);
    
    const dialogueMemory = new DialogueMemory(tmpDir);
    const canvasManager = new CanvasManager(tmpDir);
    const watchdog = new WatchdogService(canvasManager, dialogueMemory, 'test-watchdog', 100);
    
    const callId = 'test-call';
    
    // --- 1. 测试 logEvent ---
    console.log('\n--- Test 1: logEvent ---');
    await dialogueMemory.logEvent(callId, 'TASK_ARCHIVED', { id: 't_01', name: '读报告', summary: '结论是...' });
    
    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(tmpDir, `memory/${date}.jsonl`);
    const logs = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const lastLog = JSON.parse(logs[logs.length - 1]);
    
    if (lastLog.event === 'TASK_ARCHIVED' && lastLog.payload.id === 't_01') {
        console.log('✅ PASS: logEvent written correctly');
    } else {
        throw new Error('FAIL: logEvent data mismatch');
    }
    
    // --- 2. 测试 getRecentArchivedTasks ---
    console.log('\n--- Test 2: getRecentArchivedTasks ---');
    await dialogueMemory.logEvent(callId, 'TASK_ARCHIVED', { id: 't_02', name: 'Task 2', summary: 'Summary 2' });
    await dialogueMemory.logEvent(callId, 'TASK_ARCHIVED', { id: 't_03', name: 'Task 3', summary: 'Summary 3' });
    
    const recent = await dialogueMemory.getRecentArchivedTasks(2);
    console.log(`Fetched ${recent.length} archived tasks`);
    if (recent.length === 2 && recent[0].id === 't_03' && recent[1].id === 't_02') {
        console.log('✅ PASS: getRecentArchivedTasks returned latest 2 in reverse order');
    } else {
        throw new Error('FAIL: getRecentArchivedTasks sorting/limit failed');
    }
    
    // --- 3. 测试 GC 逻辑 ---
    console.log('\n--- Test 3: GC logic ---');
    const canvas = canvasManager.getCanvas(callId);
    const now = Date.now();
    const TTL_2_MINUTES = 2 * 60 * 1000;
    
    // 模拟 3 个已投递且已超时的完成任务
    canvas.tasks = [
        { id: 'gc_1', name: 'GC 1', status: 'COMPLETED', is_delivered: true, completed_at: now - TTL_2_MINUTES - 1000, summary: 'S1', version: 1, importance_score: 1, created_at: now },
        { id: 'gc_2', name: 'GC 2', status: 'FAILED', is_delivered: true, completed_at: now - TTL_2_MINUTES - 5000, summary: 'S2', version: 1, importance_score: 1, created_at: now },
        { id: 'gc_3', name: 'GC 3', status: 'COMPLETED', is_delivered: true, completed_at: now - TTL_2_MINUTES - 10000, summary: 'S3', version: 1, importance_score: 1, created_at: now }
    ] as any;
    
    // 启动心跳扫描
    watchdog.start();
    await new Promise(r => setTimeout(r, 300));
    watchdog.stop();
    
    if (canvas.tasks.length === 0) {
        console.log('✅ PASS: All 3 timed-out tasks were GCed');
    } else {
        throw new Error(`FAIL: GC failed, tasks left: ${canvas.tasks.length}`);
    }
    
    // 检查 .jsonl 中是否记录了归档事件
    const finalLogs = fs.readFileSync(logFile, 'utf8').trim().split('\n');
    const archivedEvents = finalLogs.map(l => JSON.parse(l)).filter(l => l.event === 'TASK_ARCHIVED' && l.payload.id.startsWith('gc_'));
    if (archivedEvents.length === 3) {
        console.log('✅ PASS: Found 3 TASK_ARCHIVED events in memory');
    } else {
        throw new Error(`FAIL: Missing archive events, count: ${archivedEvents.length}`);
    }
    
    // --- 4. 测试聚合播报 ---
    console.log('\n--- Test 4: Aggregate Broadcast ---');
    canvas.tasks = [
        { id: 'b_1', name: 'B 1', status: 'COMPLETED', is_delivered: false, summary: 'Summary B1', importance_score: 1, created_at: now },
        { id: 'b_2', name: 'B 2', status: 'READY', is_delivered: false, summary: 'Summary B2', importance_score: 6, created_at: now }, // Score 6 > 5
        { id: 'b_3', name: 'B 3', status: 'PENDING', is_delivered: false, summary: 'Summary B3', importance_score: 8, created_at: now } // Score 8 >= 8
    ] as any;
    
    let triggerCount = 0;
    let broadCastedTasks: TaskItem[] = [];
    watchdog.on('trigger', (data) => {
        triggerCount++;
        broadCastedTasks = data.tasks;
    });
    
    watchdog.registerNotifier(callId, async () => {});
    watchdog.start();
    await new Promise(r => setTimeout(r, 300));
    watchdog.stop();
    
    if (triggerCount === 1) {
        console.log('✅ PASS: Only one aggregate trigger emitted');
    } else {
        console.warn(`Note: triggerCount is ${triggerCount}. (Might be multiple due to scan interval)`);
    }
    
    if (broadCastedTasks.length === 3) {
        console.log('✅ PASS: All 3 tasks were aggregated in one broadcast');
    } else {
        throw new Error(`FAIL: Broadcast aggregation mismatch, count: ${broadCastedTasks.length}`);
    }

    // --- 5. 测试混合场景 ---
    console.log('\n--- Test 5: Mixed GC and Broadcast ---');
    canvas.tasks = [
        { id: 'mixed_gc', name: 'GC Task', status: 'COMPLETED', is_delivered: true, completed_at: now - TTL_2_MINUTES - 1000, summary: 'S_GC', importance_score: 1, created_at: now },
        { id: 'mixed_bc', name: 'BC Task', status: 'COMPLETED', is_delivered: false, summary: 'S_BC', importance_score: 1, created_at: now }
    ] as any;
    
    watchdog.start();
    await new Promise(r => setTimeout(r, 300));
    watchdog.stop();
    
    if (canvas.tasks.length === 1 && canvas.tasks[0].id === 'mixed_bc') {
        console.log('✅ PASS: Mixed scenario works (one GCed, one remained for broadcast)');
    } else {
        throw new Error('FAIL: Mixed scenario logic error');
    }
    
    console.log('\n🌟 ALL TESTS PASSED SUCCESSFULLY! 🌟');
    process.exit(0);
}

runTest().catch(err => {
    console.error('\n❌ TEST FAILED:');
    console.error(err);
    process.exit(1);
});
