import { CanvasManager } from '../src/agent/canvas-manager';
import { CanvasStorage } from '../src/agent/canvas-storage';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log("🚀 Starting V3.7 1A Canvas Migration Verification...");
    const workspaceRoot = path.resolve('./tmp_test_workspace');
    if (fs.existsSync(workspaceRoot)) fs.rmSync(workspaceRoot, { recursive: true, force: true });
    fs.mkdirSync(workspaceRoot, { recursive: true });
    
    const manager = new CanvasManager(workspaceRoot);
    const callId = "test-call-01";

    // 1. 创建 Canvas 并连续调用 createTask 3 次
    const t1 = manager.createTask(callId, "Task 1");
    const t2 = manager.createTask(callId, "Task 2");
    const t3 = manager.createTask(callId, "Task 3");
    
    const canvas = manager.getCanvas(callId);
    const canvases = manager.getCanvases();
    console.log(`- Created tasks. Total tasks: ${canvas.tasks.length}, Canvases size: ${canvases.size}`);
    if (canvas.tasks.length !== 3) throw new Error("Task length should be 3");

    // 2. 更新 task[1]
    await manager.updateTask(callId, t2, { summary: "Summary 2 Updated", status: "COMPLETED" });
    const task2 = manager.getTask(callId, t2);
    const task1 = manager.getTask(callId, t1);
    const task3 = manager.getTask(callId, t3);
    
    console.log(`- Task 2 status: ${task2?.status}, summary: ${task2?.summary}`);
    if (task2?.summary !== "Summary 2 Updated") throw new Error("Task 2 update failed");
    if (task1?.summary === "Summary 2 Updated" || task3?.summary === "Summary 2 Updated") throw new Error("Cluttering detected!");

    // 3. cancelTask
    manager.cancelTask(callId, t2);
    console.log(`- Task 2 canceled status: ${manager.getTask(callId, t2)?.status}`);
    if (manager.getTask(callId, t2)?.status !== "CANCELLED") throw new Error("CancelTask failed");

    // 4. getUndeliveredTasks
    await manager.updateTask(callId, t1, { status: "COMPLETED", is_delivered: false, summary: "T1 Summary" });
    await manager.updateTask(callId, t3, { status: "READY", is_delivered: false, summary: "T3 Summary" });
    const undelivered = manager.getUndeliveredTasks(callId);
    console.log(`- Undelivered count: ${undelivered.length}`);
    if (undelivered.length !== 2) throw new Error(`Expect 2 undelivered, got ${undelivered.length}`);

    // 5. markAsDelivered
    await manager.markAsDelivered(callId, t1);
    const undeliveredNew = manager.getUndeliveredTasks(callId);
    console.log(`- After markDelivered T1, undelivered count: ${undeliveredNew.length}`);
    if (undeliveredNew.length !== 1) throw new Error("MarkAsDelivered failed");
    if (manager.getTask(callId, t1)?.is_delivered !== true) throw new Error("Task 1 delivery flag failed");

    // 6. 持久化与恢复
    await manager.persistAll();
    const newManager = new CanvasManager(workspaceRoot);
    await newManager.syncCanvasesFromDisk();
    const restoredCanvas = newManager.getCanvas(callId);
    console.log(`- Restored tasks count: ${restoredCanvas.tasks.length}`);
    if (restoredCanvas.tasks.length !== 3) throw new Error("Persistence failed");
    if (restoredCanvas.tasks[0].id !== t1 || restoredCanvas.tasks[0].summary !== "T1 Summary") throw new Error("Data data corrupted after restore");

    // 7. 旧格式迁移验证
    const legacySnapshotPath = path.join(workspaceRoot, 'logs', 'canvas_snapshot.json');
    const legacyData = {
        "legacy-call": {
            "env": { "time": "2026", "weather": "Sunny" },
            "task_status": {
                "taskId": "legacy-task-id",
                "status": "COMPLETED",
                "summary": "Legacy content",
                "version": 12345
            },
            "context": { "last_spoken_fragment": "" }
        }
    };
    fs.writeFileSync(legacySnapshotPath, JSON.stringify(legacyData));
    
    const migrationManager = new CanvasManager(workspaceRoot);
    await migrationManager.syncCanvasesFromDisk();
    const migratedCanvas = migrationManager.getCanvas("legacy-call");
    console.log(`- Migrated tasks count: ${migratedCanvas.tasks.length}`);
    if (migratedCanvas.tasks.length !== 1) throw new Error("Migration failed: tasks length should be 1");
    console.log(`- Migrated task ID: ${migratedCanvas.tasks[0].id}, Content: ${migratedCanvas.tasks[0].summary}`);
    if (migratedCanvas.tasks[0].id !== "legacy-task-id") throw new Error("Migration ID mismatch");

    console.log("\n✅ ALL TESTS PASSED!");
    
    // Cleanup
    fs.rmSync(workspaceRoot, { recursive: true, force: true });
    process.exit(0);
}

verify().catch(e => {
    console.error("\n❌ VERIFICATION FAILED:");
    console.error(e);
    process.exit(1);
});
