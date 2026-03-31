import { CallManager } from '../src/call/call-manager';
import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CanvasManager } from '../src/agent/canvas-manager';

async function verify() {
    console.log("=== [V3.5.3 Parallel Verification Start] ===");

    const workspace = "./tmp_test_workspace";
    const cm = new CallManager({
        zego: { appId: 0, serverSecret: "", aiAgentBaseUrl: "" },
        llm: { provider: "openai", apiKey: "", model: "", baseUrl: "" },
        tts: { vendor: "zego", appId: 0, token: "", voiceType: "" }
    } as any);
    const userId = "test-call-id";
    cm.createCall(userId);

    const mockExecutor = {
        executeOpenClaw: async (id: string, intent: string) => {
            console.log(`[MOCK] Executing OpenClaw: ${intent}`);
            // 模拟长耗时任务返回 timeout 提升等级
            return { stdout: "Task Result", stderr: "", isTimeout: false };
        }
    } as any;

    const mockSummarizer = {
        summarizeTaskResult: async (result: string, intent: string) => {
            return `Summary of ${intent}: ${result}`;
        }
    } as any;

    const canvasMgr = new CanvasManager(workspace);
    const trh = new ToolResultHandler(mockExecutor, mockSummarizer, workspace, cm);

    // 等待核心工具注册完成 (V3.5.2 异步加载导致)
    await new Promise(resolve => setTimeout(resolve, 500));

    const canvas = canvasMgr.getCanvas(userId);
    let eventLog: string[] = [];

    // 拦截日志观察顺序
    const originalLog = canvasMgr.logCanvasEvent.bind(canvasMgr);
    canvasMgr.logCanvasEvent = async (id: string, event: string, detail: any) => {
        eventLog.push(event);
        console.log(`[EVENT] ${event}`, detail);
        return originalLog(id, event, detail);
    };

    // 并行调用：搜索 + 纠错 (故意打乱顺序，验证排序逻辑)
    const toolCalls = [
        {
            function: {
                name: 'delegate_openclaw',
                arguments: JSON.stringify({ intent: "查一下极客科技的待办" })
            }
        },
        {
            function: {
                name: 'correct_asr_hotword',
                arguments: JSON.stringify({ original_word: "机构", corrected_word: "极客" })
            }
        }
    ];

    console.log("\n1. Executing Composite Tool Calls...");
    await trh.handleToolCalls(toolCalls, "不是机构是极客，帮我查一下极客科技的待办", userId, canvas, canvasMgr);

    console.log("\n2. Verifying Results...");
    console.log("Event Log order:", eventLog);

    // ASR 纠错是同步的，Delegate 是异步长周期的。
    // 在 handleToolCalls 中，我们排序后，ASR 应该先执行， Delegate 后执行（被抛入后台）。

    // 验证 ASR_CORRECTED 必须在 DELEGATE_EXECUTING 之前 (优先级排序)
    const asrIndex = eventLog.indexOf('ASR_CORRECTED');
    const delegateIndex = eventLog.indexOf('DELEGATE_EXECUTING');

    if (asrIndex !== -1 && delegateIndex !== -1 && asrIndex < delegateIndex) {
        console.log("✅ (1) ASR Priority Verified (ASR executed before Delegate).");
    } else {
        throw new Error(`❌ (1) ASR Priority failed! asrIndex: ${asrIndex}, delegateIndex: ${delegateIndex}`);
    }

    // 验证状态机：包含长周期任务时，最终状态必须维持在 PENDING，引导 SLC 抢先播报 Filler
    if (canvas.task_status.status === 'PENDING') {
        console.log("✅ (2) Final Status is PENDING (Correct for Async).");
    } else {
        throw new Error(`❌ (2) Status should be PENDING, got ${canvas.task_status.status}`);
    }

    // 验证 Summary 聚合：确保同步工具的结果（纠错指令）与异步任务的摘要没有互相覆盖
    console.log("Final Summary Check:\n", canvas.task_status.summary);
    const hasDirective = canvas.task_status.summary.includes("[ASR 纠错情报]");
    const hasDelegate = canvas.task_status.summary.includes("正在委派任务");

    if (hasDirective && hasDelegate) {
        console.log("✅ (3) Summary aggregation (subconscious + intent) OK.");
    } else {
        throw new Error(`❌ (3) Summary aggregation failed! hasDirective: ${hasDirective}, hasDelegate: ${hasDelegate}`);
    }

    console.log("\n=== [V3.5.3 Parallel Verification Passed Successfully] ===");
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
