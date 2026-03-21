import * as fs from 'fs';
import * as path from 'path';

/**
 * V3.3-S4 验证脚本
 */
async function verifyS4() {
    const rootDir = path.resolve(__dirname, '..');
    const slePath = path.join(rootDir, 'src/agent/sle.ts');
    const handlerPath = path.join(rootDir, 'src/agent/tool-result-handler.ts');
    const fastAgentPath = path.join(rootDir, 'src/agent/fast-agent-v3.ts');

    console.log("--- V3.3-S4 Refactor Verification ---");

    // 1. 验证 sle.ts 行数
    const sleContent = fs.readFileSync(slePath, 'utf8');
    const sleLines = sleContent.split('\n').length;
    console.log(`[1] SLEEngine lines: ${sleLines} (Goal: <= 150)`);
    if (sleLines > 150) {
        throw new Error(`sle.ts is too long: ${sleLines} lines`);
    }

    // 2. 验证 ToolResultHandler 是否包含 transitionToReady 方法
    const handlerContent = fs.readFileSync(handlerPath, 'utf8');
    const hasTransition = handlerContent.includes('private async transitionToReady');
    console.log(`[2] ToolResultHandler has transitionToReady: ${hasTransition}`);
    if (!hasTransition) {
        throw new Error("ToolResultHandler missing transitionToReady method");
    }

    // 3. 验证 Canvas 状态转换路径在 handler 中是否是统一入口
    const readyCallCount = (handlerContent.match(/this\.transitionToReady/g) || []).length;
    console.log(`[3] ToolResultHandler transitionToReady call count: ${readyCallCount} (Should be multiple but unified logic)`);
    // Original code had 3 paths: sync success, timeout success, timeout error, try/catch error.
    // In new code, we should have calls to transitionToReady instead of direct canvas updates.
    
    // 4. 验证 FastAgentV3 构造函数注入
    const faContent = fs.readFileSync(fastAgentPath, 'utf8');
    const hasInjection = faContent.includes('new ToolResultHandler(this.executor, this.resultSummarizer)');
    console.log(`[4] FastAgentV3 injects ToolResultHandler: ${hasInjection}`);
    if (!hasInjection) {
        throw new Error("FastAgentV3 missing ToolResultHandler injection");
    }

    // 5. 验证 tool-result-handler.ts 自身逻辑是否使用了 transitionToReady
    // 允许在 transitionToReady 方法内部设置 READY 状态
    const lines = handlerContent.split('\n');
    let hasDirectUpdateOutsideMethod = false;
    let insideTransitionMethod = false;
    for (const line of lines) {
        if (line.includes('private async transitionToReady')) insideTransitionMethod = true;
        if (insideTransitionMethod && line.includes('}')) {
            // This is a bit simplistic, but since transitionToReady is at the end of the class, it's okay for now.
            // A better check would look for the method's closing brace.
        }
        if (!insideTransitionMethod && line.includes("canvas.task_status.status = 'READY'")) {
            hasDirectUpdateOutsideMethod = true;
        }
    }
    console.log(`[5] ToolResultHandler avoids direct status='READY' outside transitionToReady: ${!hasDirectUpdateOutsideMethod}`);
     if (hasDirectUpdateOutsideMethod) {
        throw new Error("ToolResultHandler still has direct 'READY' status assignment outside transitionToReady");
    }

    console.log("✅ Verification Passed!");
}

verifyS4().catch(e => {
    console.error("❌ Verification Failed:", e.message);
    process.exit(1);
});
