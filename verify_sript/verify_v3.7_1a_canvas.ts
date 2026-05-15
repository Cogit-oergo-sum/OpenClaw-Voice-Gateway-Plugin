import { CanvasManager } from '../src/agent/canvas-manager';
import { CanvasStorage } from '../src/agent/canvas-storage';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    console.log('--- 启动 1A 验证 ---');
    const mockWorkspace = path.join(__dirname, '..', 'mock_workspace_1a');
    if (!fs.existsSync(mockWorkspace)) {
        fs.mkdirSync(mockWorkspace, { recursive: true });
    }
    
    const manager = new CanvasManager(mockWorkspace);
    const callId = 'test_call_1a';
    
    // 1. 创建 Canvas，连续调用 createTask 3 次
    const t1 = manager.createTask(callId, 'Task 1');
    const t2 = manager.createTask(callId, 'Task 2');
    const t3 = manager.createTask(callId, 'Task 3');
    
    const canvas = manager.getCanvas(callId);
    if (canvas.tasks.length !== 3) {
        throw new Error(`[FAIL] Expected 3 tasks, got ${canvas.tasks.length}`);
    }
    console.log('✅ 1. createTask 成功，tasks.length 为 3');
    
    // 2. 对 task[1] 调用 updateTask 更新 summary
    await manager.updateTask(callId, t2, { summary: 'New summary for t2', status: 'COMPLETED' });
    const tasksAfterUpdate = manager.getCanvas(callId).tasks;
    if (tasksAfterUpdate[1].summary !== 'New summary for t2' || tasksAfterUpdate[1].status !== 'COMPLETED') {
        throw new Error(`[FAIL] Expected task 2 to be updated, got ${JSON.stringify(tasksAfterUpdate[1])}`);
    }
    if (tasksAfterUpdate[0].status === 'COMPLETED' || tasksAfterUpdate[2].status === 'COMPLETED') {
         throw new Error(`[FAIL] Expected other tasks to not be affected.`);
    }
    console.log('✅ 2. updateTask 成功，仅 t2 被修改');
    
    // 3. cancelTask(task[1].id)
    manager.cancelTask(callId, t2);
    if (manager.getCanvas(callId).tasks[1].status !== 'CANCELLED') {
        throw new Error(`[FAIL] Expected task 2 to be CANCELLED.`);
    }
    if (manager.getCanvas(callId).tasks[0].status === 'CANCELLED') {
         throw new Error(`[FAIL] Expected other tasks to not be affected.`);
    }
    console.log('✅ 3. cancelTask 成功，t2 状态为 CANCELLED');
    
    // 4. getUndeliveredTasks
    // 当前任务状态：
    // t1: PENDING (is_delivered: false)
    // t2: CANCELLED (is_delivered: false)
    // t3: PENDING (is_delivered: false)
    // UNDELIVERED 只返回 READY/COMPLETED/FAILED
    await manager.updateTask(callId, t1, { status: 'READY' });
    await manager.updateTask(callId, t3, { status: 'COMPLETED' });
    const undelivered = manager.getUndeliveredTasks(callId);
    if (undelivered.length !== 2) {
        throw new Error(`[FAIL] Expected 2 undelivered tasks (READY, COMPLETED), got ${undelivered.length}`);
    }
    console.log('✅ 4. getUndeliveredTasks 成功，返回 2 个任务');
    
    // 5. markAsDelivered(task[0].id)
    await manager.markAsDelivered(callId, t1);
    if (!manager.getCanvas(callId).tasks[0].is_delivered) {
         throw new Error(`[FAIL] Expected task 1 to be delivered.`);
    }
    if (manager.getCanvas(callId).tasks[2].is_delivered) {
          throw new Error(`[FAIL] Expected task 3 to not be delivered.`);
    }
    console.log('✅ 5. markAsDelivered 成功，仅 t1 标记');
    
    // 6. 持久化到磁盘再恢复
    await new Promise(r => setTimeout(r, 500)); // wait for background writes to finish
    await manager.persistAll();
    const snapshotPath = path.join(mockWorkspace, 'logs', 'canvas_snapshot.json');
    if (!fs.existsSync(snapshotPath)) throw new Error('Snapshot file not created');
    
    const manager2 = new CanvasManager(mockWorkspace);
    await manager2.syncCanvasesFromDisk();
    const restoredCanvas = manager2.getCanvas(callId);
    if (restoredCanvas.tasks.length !== 3) {
         throw new Error(`[FAIL] Restored canvas has wrong tasks length. Expected 3, got ${restoredCanvas.tasks.length}`);
    }
    console.log('✅ 6. 持久化与恢复成功，数据完整');
    
    // 7. 旧格式磁盘文件读取后自动迁移为 tasks[]
    const legacyPath = path.join(mockWorkspace, 'logs', 'legacy_snapshot.json');
    fs.writeFileSync(legacyPath, JSON.stringify({
        'legacy_call': {
            env: { time: '', weather: 'Unknown' },
            task_status: { status: 'READY', taskId: 'old_t1', version: 123, is_delivered: false, summary: 'old summary' },
            context: { last_spoken_fragment: '', interrupted: false, last_interaction_time: 0, is_busy: false }
        }
    }));
    
    const manager3 = new CanvasManager(mockWorkspace);
    const mockMap = new Map();
    await CanvasStorage.syncFromDisk(legacyPath, mockMap);
    const legacyCanvas = mockMap.get('legacy_call');
    if (!legacyCanvas.tasks || legacyCanvas.tasks.length !== 1 || legacyCanvas.tasks[0].id !== 'old_t1') {
        throw new Error(`[FAIL] Legacy migration failed: ${JSON.stringify(legacyCanvas)}`);
    }
    console.log('✅ 7. 旧数据向下兼容恢复为 tasks[] 成功');
    
    console.log('--- 1A 验证全部通过 ---');
    process.exit(0);
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
