import { CanvasManager } from '../src/agent/canvas-manager';
import { SLEScenario, TaskItem } from '../src/agent/types';
import * as path from 'path';
import * as fs from 'fs';

async function verify() {
    console.log('--- 启动 V3.7.1 Schema 验证 ---');
    const mockWorkspace = path.join(__dirname, '..', 'mock_workspace_schema');
    if (!fs.existsSync(mockWorkspace)) {
        fs.mkdirSync(mockWorkspace, { recursive: true });
    }
    
    // 1. 验证 SLEScenario 包含 REFINING
    const scenarios: SLEScenario[] = ['ROUTING', 'DECIDING', 'REFINING', 'SUMMARIZING', 'ASR_CORRECTION'];
    console.log('✅ 1. SLEScenario 枚举检查通过 (静态检查)');

    const manager = new CanvasManager(mockWorkspace);
    const callId = 'test_call_schema';
    
    // 2. 验证 createTask 时有 updated_at
    const taskId = manager.createTask(callId, 'Test Task');
    const task = manager.getTask(callId, taskId) as TaskItem;
    
    if (!task.updated_at) {
        throw new Error('[FAIL] Task created without updated_at');
    }
    console.log(`✅ 2. createTask 成功，updated_at: ${task.updated_at}`);

    // 3. 验证 updateTask 更新 updated_at
    const initialUpdatedAt = task.updated_at;
    await new Promise(r => setTimeout(r, 10)); // 等待一下
    await manager.updateTask(callId, taskId, { progress: 50 });
    
    const updatedTask = manager.getTask(callId, taskId) as TaskItem;
    if (updatedTask.updated_at <= initialUpdatedAt) {
        throw new Error(`[FAIL] updateTask did not update updated_at. Before: ${initialUpdatedAt}, After: ${updatedTask.updated_at}`);
    }
    console.log(`✅ 3. updateTask 成功更新 updated_at: ${updatedTask.updated_at}`);

    // 4. 验证状态迁移时重置 is_delivered
    // 先手动设为 true
    updatedTask.is_delivered = true;
    
    // A. 状态未变迁 (READY -> READY)
    await manager.updateTask(callId, taskId, { status: 'READY' });
    if (updatedTask.is_delivered) {
        console.log('✅ 4A. 状态未变迁，is_delivered 保持 true (预期行为)');
    } else {
         throw new Error('[FAIL] is_delivered was reset even if status did not change');
    }

    // B. 状态变迁 (READY -> COMPLETED)
    await manager.updateTask(callId, taskId, { status: 'COMPLETED' });
    if (updatedTask.is_delivered) {
        throw new Error('[FAIL] is_delivered was NOT reset during status transition');
    }
    console.log('✅ 4B. 状态变迁 (COMPLETED)，is_delivered 已重置为 false');

    // C. 状态变迁 (COMPLETED -> FAILED)
    updatedTask.is_delivered = true;
    await manager.updateTask(callId, taskId, { status: 'FAILED' });
    if (updatedTask.is_delivered) {
        throw new Error('[FAIL] is_delivered was NOT reset during transition to FAILED');
    }
    console.log('✅ 4C. 状态变迁 (FAILED)，is_delivered 已重置为 false');

    console.log('--- V3.7.1 Schema 验证全部通过 ---');
    process.exit(0);
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
