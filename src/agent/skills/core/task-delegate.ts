import { IFastSkill } from '../iskill';
import { CanvasManager } from '../../canvas-manager';
import { DelegateExecutor } from '../../executor';

/**
 * [V3.5.3] TaskDelegateSkill: 内核级 OpenClaw 任务委派工具
 * 职责：将复杂逻辑或文件操作委派给 OpenClaw Agent 执行
 */
export class TaskDelegateSkill implements IFastSkill {
    name = 'delegate_openclaw';
    description = '将任务（如：查询文件、写文件、搜资料、分析代码等所有需要操作电脑的任务）委派给 OpenClaw 后台专家处理。此工具耗时较长（>2秒）。';
    "parameters": {
        "type": "object",
        "properties": {
            "command": {
                "type": "string",
                "description": "【核心执行参数】重写后的完整任务指令。你必须结合历史上下文，进行实体补全和指代消解。严禁直接传入用户的原始口语化输入。例如：将'明天开会带伞吗'重写为'查询2026年3月28日深圳是否下雨'。"
            }
        },
        "required": ["command"]
    };
    isLongRunning = true; // 典型的长耗时任务

    constructor(private executor: DelegateExecutor) { }

    async execute(args: any, callId: string, canvasManager: CanvasManager, taskId?: string): Promise<string> {
        const command = args.command || args.intent || args.query || "";

        // 1. 设置 PENDING 状态
        const canvas = canvasManager.getCanvas(callId);
        canvas.task_status.status = 'PENDING';
        const currentSummary = canvas.task_status.summary || '';
        const pendingMsg = `正在委派任务: ${command}...`;
        if (!currentSummary.includes(pendingMsg)) {
            canvas.task_status.summary = `${currentSummary}\n${pendingMsg}`.trim();
        }
        canvas.task_status.is_delivered = false;
        canvas.task_status.version = Date.now();

        await canvasManager.logCanvasEvent(callId, 'DELEGATE_EXECUTING', { command, taskId });

        // 2. 执行委派
        const result = await this.executor.executeOpenClaw(callId, command);

        const extractText = (res: any) => DelegateExecutor.distill(res);

        if (result.isTimeout && result._pendingPromise) {
            // 🚀 [V3.5.3] 结果接力 (Result Relay)：如果触发 超时赛跑，开启后台线程继续监听真正结果
            const pending = result._pendingPromise;
            Promise.resolve().then(async () => {
                let progressTimer: any = null;
                try {
                    // [V3.6.18] 模拟中间进度更新：如果任务在 5s 内没出结果，给一个中间状态心跳
                    progressTimer = setInterval(async () => {
                        const c = canvasManager.getCanvas(callId);
                        if (c.task_status.status === 'PENDING') {
                            c.task_status.summary += "\n[System] 后台任务仍在深度处理中，请稍候...";
                            c.task_status.version = Date.now(); // 强制触发版本更新
                            await canvasManager.logCanvasEvent(callId, 'DELEGATE_HEARTBEAT', { command });
                        } else {
                            if (progressTimer) clearInterval(progressTimer);
                        }
                    }, 10000); // 10秒一次中间心跳

                    const finalResult = await this.executor.waitAndParse(pending);
                    const finalText = extractText(finalResult);

                    // 💡 到达最终结果：直接静默重写 Canvas。Watchdog 会感应到 READY 并执行最终播报。
                    await canvasManager.appendCanvasAudit(
                        callId,
                        finalText,
                        'READY', // 最终结果，标记为 READY
                        false,   // 未投递，触发 Watchdog 播报
                        taskId   // [V3.6.21] 传递 taskId 校验
                    );
                } catch (e: any) {
                    console.error(`[TaskDelegate Relay Error] ${e.message}`);
                    await canvasManager.appendCanvasAudit(callId, `任务执行异常中断: ${e.message}`, 'READY', false, taskId);
                } finally {
                    if (progressTimer) clearInterval(progressTimer);
                }
            });
            return `任务已在后台启动，耗时较长正在努力处理中：${command}`;
        }

        return extractText(result);
    }
}
