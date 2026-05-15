import { IFastSkill } from '../iskill';
import { CanvasManager } from '../../canvas-manager';
import { DelegateExecutor } from '../../executor';
import { ToolBackend } from '../../tool-backend';

/**
 * [V4.0] TaskDelegateSkill: 通用任务委派工具
 * 职责：将复杂逻辑或文件操作委派给后台专家处理
 *
 * 支持多种 backend：
 * - openClaw Docker（原有模式）
 * - Mock（开发调试）
 * - HTTP（外部服务）
 * - MCP（未来扩展）
 *
 * [V3.10.0] 改用动态 Agent 模式：每个 taskId 对应独立的 Agent
 */
export class TaskDelegateSkill implements IFastSkill {
    // [V4.0] 通用化 skill 名称，但仍保持向后兼容
    name = 'delegate_task';
    // 别名，用于向后兼容
    aliases = ['delegate_openclaw'];

    description = '将复杂的任务（如：查询文件、写文件、搜资料、分析代码等所有需要操作电脑的任务）委派给后台专家处理。此工具耗时较长（>2秒）。';
    parameters = {
        type: 'object',
        properties: {
            command: {
                type: 'string',
                description: "【核心执行参数】重写后的完整任务指令。你必须结合历史上下文，进行实体补全和指代消解。严禁直接传入用户的原始口语化输入。例如：将'明天开会带伞吗'重写为'查询2026年3月28日深圳是否下雨'。"
            },
            backend: {
                type: 'string',
                description: "可选：指定使用的后端类型 (openclaw, http, mock)。默认使用系统配置的后端。"
            }
        },
        required: ["command"]
    };
    isLongRunning = true; // 典型的长耗时任务
    source: 'core' | 'external' = 'external';

    constructor(private executor: DelegateExecutor) { }

    /**
     * [V4.0] 获取实际使用的 skill 名称
     * 向后兼容：如果调用方使用旧名称 delegate_openclaw，也能正常工作
     */
    getEffectiveName(): string {
        return this.name;
    }

    async execute(args: any, callId: string, canvasManager: CanvasManager, taskId?: string, options?: { signal?: AbortSignal; onTaskReady?: (callId: string, taskId: string, result: string) => Promise<void> }): Promise<string> {
        const command = args.command || args.intent || args.query || "";
        const onTaskReady = options?.onTaskReady;

        // [V4.0] 获取 backend 类型
        const backendType = this.executor.getBackendType();

        // 1. 获取目标 task（先获取以便复用已有 agentId）
        const canvas = canvasManager.getCanvas(callId);
        const targetTaskId = taskId || (canvas.tasks.length > 0 ? canvas.tasks[canvas.tasks.length - 1].id : "legacy");
        const activeTask = canvas.tasks.find(t => t.id === targetTaskId);

        // [V3.10 FIX] Agent 复用逻辑：同一 taskId 的多轮交互必须复用同一个 Agent
        // 确保用户后续追问/确认能访问之前操作的文件和对话上下文
        // 注意：canvas.task_status 没有 tool_agent_id 字段，只有 TaskItem 有
        const existingAgentId = activeTask?.tool_agent_id;
        const agentId = backendType === 'mock'
            ? `mock_${taskId}`
            : (existingAgentId || taskId || `agent_${callId}_${Date.now()}`);

        if (existingAgentId) {
            console.log(`[TaskDelegate] 🔗 复用已有 Agent: ${existingAgentId} for task ${targetTaskId}`);
        }

        // 2. 设置 PENDING 状态（仅在首次创建时记录 tool_agent_id）
        const currentSummary = (activeTask?.summary || canvas.task_status.summary) || '';
        const backendLabel = backendType === 'mock' ? '[MOCK]' : backendType === 'openclaw-docker' ? '[OpenClaw]' : '[Backend]';
        const pendingMsg = `${backendLabel} 正在委派任务: ${command}...`;
        let newSummary = currentSummary;
        if (!currentSummary.includes(pendingMsg)) {
            newSummary = `${currentSummary}\n${pendingMsg}`.trim();
        }

        // 仅在首次（无 existingAgentId）且是 TaskItem 时写入 tool_agent_id
        const updateData: any = {
            status: 'PENDING',
            summary: newSummary,
            is_delivered: false,
            version: Date.now()
        };
        if (!existingAgentId && activeTask) {
            updateData.tool_agent_id = agentId;
        }

        await canvasManager.updateTask(callId, targetTaskId, updateData);

        await canvasManager.logCanvasEvent(callId, 'DELEGATE_EXECUTING', { command, taskId, agentId, backendType });

        // 2. 根据 backend 类型选择执行方式
        let result;
        if (backendType === 'mock') {
            // Mock 模式：直接通过 backend 执行，无需 Agent 管理
            result = await this.executor.executeOpenClaw(callId, command);
        } else {
            // openClaw Docker 模式：使用 Agent 管理
            result = await this.executor.executeOpenClawWithAgent(agentId, command);
        }

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
                        const curTask = taskId ? (c.tasks.find(t => t.id === taskId)) : (c.tasks[c.tasks.length - 1]);
                        if (curTask && curTask.status === 'PENDING') {
                            await canvasManager.updateTask(callId, curTask.id!, {
                                summary: (curTask.summary || "") + "\n[System] 后台任务仍在深度处理中，请稍候...",
                                version: Date.now()
                            });
                            await canvasManager.logCanvasEvent(callId, 'DELEGATE_HEARTBEAT', { command, taskId, agentId });
                        } else {
                            if (progressTimer) clearInterval(progressTimer);
                        }
                    }, 10000); // 10秒一次中间心跳

                    const finalResult = await this.executor.waitAndParse(pending);
                    const finalText = extractText(finalResult);

                    // [V3.7.3] 关键修复：异步接力路径也需通过 SUMMARIZING 提纯
                    if (onTaskReady && taskId) {
                        console.log(`[TaskDelegate Relay] Triggering SUMMARIZING via onTaskReady for task ${taskId}`);
                        await onTaskReady(callId, taskId, finalText);
                    } else {
                        console.warn(`[TaskDelegate Relay] ⚠️ No onTaskReady callback, falling back to direct Canvas write`);
                        await canvasManager.appendCanvasAudit(
                            callId,
                            finalText,
                            'READY',
                            false,
                            taskId
                        );
                    }
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

/**
 * [V4.0] 向后兼容别名导出
 * 现有代码仍可使用 delegate_openclaw 名称
 */
export class TaskDelegateOpenClawSkill extends TaskDelegateSkill {
    name = 'delegate_openclaw';
    aliases = [];
}
