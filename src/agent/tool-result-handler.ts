import { DelegateExecutor } from './executor';
import { ResultSummarizer } from './result-summarizer';
import { CanvasManager } from './canvas-manager';
import { CanvasState } from './types';
import { CallManager } from '../call/call-manager';
import { SkillRegistry } from './skills';
import { PromptAssembler } from './prompt-assembler';
import * as path from 'path';

/**
 * [V3.3.0] ToolResultHandler: 工具执行结果处理器 (V3.6 Slim)
 */
export class ToolResultHandler {
    constructor(
        private executor: DelegateExecutor,
        private summarizer: ResultSummarizer,
        private workspaceRoot: string,
        private callManager?: CallManager,
        private promptAssembler?: PromptAssembler
    ) {
        const registry = SkillRegistry.getInstance();
        registry.registerCoreSkills(this.executor, this.callManager);
        const repoDir = path.join(path.resolve(__dirname, '../../'), 'skills_repo');
        registry.loadFromDirectory(repoDir);
        registry.loadFromDirectory(path.join(this.workspaceRoot, 'skills_repo'));
        registry.loadFromDirectory(path.join(this.workspaceRoot, 'skills'));
    }

    private lastHandledVersions: Map<string, number> = new Map();
    private lastSummarizedOutputs: Map<string, string> = new Map();
    private activeMonitors: Set<string> = new Set();
    private abortControllers: Map<string, AbortController> = new Map();
    private onTaskReady?: (callId: string, taskId: string, result: string, tracker?: any) => Promise<void>;  // [V3.7.2] 增加 tracker 参数

    /**
     * [V3.7.1] 设置任务就绪监听器 (对齐 Orchestrator)
     */
    setTaskReadyCallback(cb: (callId: string, taskId: string, result: string, tracker?: any) => Promise<void>) {
        this.onTaskReady = cb;
    }

    /**
     * [V3.7] 物理中断指定任务
     */
    abortTask(taskId: string): boolean {
        const controller = this.abortControllers.get(taskId);
        if (controller) {
            controller.abort();
            this.abortControllers.delete(taskId);
            console.log(`[ToolResultHandler] 🛑 Task ${taskId} physically aborted.`);
            return true;
        }
        return false;
    }

    async handleToolCalls(toolCalls: any[], text: string, callId: string, canvas: CanvasState, canvasManager: CanvasManager, taskId?: string, tracker?: any): Promise<void> {
        // [V3.7.2] 耗时追踪: 工具执行开始
        if (tracker) tracker.record('TOOL_START');

        const sortedTools = [...toolCalls].sort((a, b) => a.function.name === 'correct_asr_hotword' ? -1 : 1);
        const registry = SkillRegistry.getInstance();
        let hasLongRunning = false;
        let combinedSummary = "";

        const intents = sortedTools.map(tc => {
            const args = JSON.parse(tc.function.arguments || '{}');
            const cmd = args.command || args.intent || args.query || "";
            return tc.function.name === 'correct_asr_hotword' 
                ? `ASR纠错(${args.original_word}→${args.corrected_word})` 
                : (cmd || `(执行:${tc.function.name})`);
        });

        // [V3.7] 初始化任务状态：仅记录纯粹的任务元数据，由 SLC 负责拟人化播报
        const taskLabels = intents.join('、');

        if (taskId) {
            await canvasManager.updateTask(callId, taskId, {
                status: 'PENDING',
                summary: taskLabels
            });
        } else {
            canvas.task_status.status = 'PENDING';
            canvas.task_status.summary = taskLabels;
        }
        await canvasManager.logCanvasEvent(callId, 'CANVAS_PENDING_MULTI', { taskId, intents });

        for (const tc of sortedTools) {
            const args = JSON.parse(tc.function.arguments || '{}');
            const command = args.command || args.intent || args.query || text;
            const skill = registry.getSkill(tc.function.name);
            if (!skill) continue;

            try {
                if (skill.isLongRunning) {
                    hasLongRunning = true;
                    // [V3.7] 注册中断控制器
                    const abortController = new AbortController();
                    if (taskId) this.abortControllers.set(taskId, abortController);

                    // [V3.6.18] 进度监视器：针对长耗时任务开启增量摘要循环
                    Promise.resolve().then(async () => {
                        const monitorId = `${callId}-${skill.name}-${taskId || 'legacy'}`;
                        if (this.activeMonitors.has(monitorId)) {
                            console.log(`[ToolResultHandler] Monitor for ${monitorId} already active. Skipping duplicate.`);
                            return;
                        }
                        this.activeMonitors.add(monitorId);

                        console.log(`[ToolResultHandler] Starting Progressive Monitor for ${monitorId}`);

                        // 1. 设置初始快照，防止空摘要触发首次误判
                        const initialTask = taskId ? canvasManager.getTask(callId, taskId) : canvas.task_status;
                        this.lastHandledVersions.set(monitorId, initialTask?.version || Date.now());
                        this.lastSummarizedOutputs.set(monitorId, initialTask?.summary || "");

                        // 2. 启动执行并监听中间状态
                        // [V3.7.3] 传递 onTaskReady 回调，确保 TaskDelegateSkill 的异步接力路径也能触发 SUMMARIZING 提纯
                        const executionPromise = (skill as any).execute(args, callId, canvasManager, taskId, {
                            signal: abortController.signal,
                            onTaskReady: this.onTaskReady
                        });

                        // 定时检查 Canvas 更新 (增量摘要逻辑: 2秒一次心跳探测)
                        let isProcessingInterval = false;
                        const checkInterval = setInterval(async () => {
                            if (isProcessingInterval) return; // 防止 LLM 调用积压导致并发堆叠
                            isProcessingInterval = true;

                            try {
                                const currentCanvas = canvasManager.getCanvas(callId);
                                const lastVer = this.lastHandledVersions.get(monitorId) || 0;
                                const lastOut = this.lastSummarizedOutputs.get(monitorId) || "";

                                // [逻辑条件]：仍在处理中 && (磁盘/内存版本已更新 && 当前内容不等于上次产出的摘要)
                                const activeTask = taskId ? canvasManager.getTask(callId, taskId) : currentCanvas.task_status;
                                if (!activeTask) return;

                                // [V3.7] 检测任务是否已被取消
                                if (activeTask.status === 'CANCELLED') {
                                    console.log(`[ToolResultHandler] 🛑 Monitor detected CANCELLED status for ${monitorId}. Stopping.`);
                                    clearInterval(checkInterval);
                                    if (taskId) this.abortControllers.delete(taskId);
                                    // [V3.7.2] 任务取消时记录 TOOL_END
                                    if (tracker) tracker.record('TOOL_END');
                                    return;
                                }

                                if (activeTask.status === 'PENDING' &&
                                    activeTask.version > lastVer &&
                                    activeTask.summary !== lastOut &&
                                    activeTask.summary !== ""
                                ) {
                                    console.log(`[ToolResultHandler] 🔄 Progressive summary triggered for ${monitorId} (v${currentCanvas.task_status.version})`);

                                    // [V3.6.4修正] 进度同步不再独立提纯，而是直接写入原始文本，由交付通道统一通过 SLE(SUMMARIZING) 提纯。
                                    // 这样能消除冗余的 LLM 调用并解决任务结果同步与异步交互冲突。
                                    const rawUpdate = currentCanvas.task_status.summary;
                                    await canvasManager.appendCanvasAudit(callId, rawUpdate, 'PENDING', false, taskId);

                                    // 记录产出的摘要，下一轮以此为基准判断 Tool 是否有新输出
                                    this.lastSummarizedOutputs.set(monitorId, canvasManager.getCanvas(callId).task_status.summary);
                                    this.lastHandledVersions.set(monitorId, canvasManager.getCanvas(callId).task_status.version);
                                }

                                if (currentCanvas.task_status.status !== 'PENDING') {
                                    clearInterval(checkInterval);
                                    this.lastHandledVersions.delete(monitorId);
                                    this.lastSummarizedOutputs.delete(monitorId);
                                    this.activeMonitors.delete(monitorId);
                                }
                            } finally {
                                isProcessingInterval = false;
                            }
                        }, 2000);

                        // 3. 等待最终结果
                        const raw = await executionPromise;

                        // [V3.7.2] 长耗时任务完成: 记录 TOOL_END
                        if (tracker) tracker.record('TOOL_END');

                        // [V3.6.19] 关键修复：识别"后台启动"提示。
                        // 如果返回的是 TaskDelegateSkill 产生的后台挂起提示词，则维持 PENDING。
                        // 否则对于长耗时工具，Promise 完成即代表结果就绪 (READY)。
                        const isFinal = !raw.includes('任务已在后台启动');

                        clearInterval(checkInterval);
                        // [V3.7.1] 流程对齐：长耗时任务完成后，不再直接标记 READY
                        // 而是通过回调交给 Orchestrator 进行 SLE 提纯，提纯后再标记 READY
                        if (isFinal && this.onTaskReady && taskId) {
                            await this.onTaskReady(callId, taskId, raw, tracker);  // [V3.7.2] 传递 tracker
                        } else {
                            await canvasManager.appendCanvasAudit(callId, raw, isFinal ? 'READY' : 'PENDING', false, taskId);
                        }
                    }).catch(async e => {
                        // [V3.7.2] 长耗时任务失败: 记录 TOOL_END
                        if (tracker) tracker.record('TOOL_END');
                        console.error(`[ToolResultHandler] Long-running tool error:`, e);
                        // [V4.6] 异常应标记 FAILED 而非 READY，防止 Watchdog 高优播报 + SLE 自动重试
                        await canvasManager.appendCanvasAudit(callId, `[${skill.name}] 任务执行异常: ${e.message}`, 'FAILED', false, taskId);
                    });
                } else {
                    combinedSummary += (combinedSummary ? "\n" : "") + await skill.execute(args, callId, canvasManager);
                }
            } catch (e: any) { combinedSummary += (combinedSummary ? "\n" : "") + `[${skill.name}] 失败: ${e.message}`; }
        }

        if (hasLongRunning) {
            if (taskId) {
                const task = canvasManager.getTask(callId, taskId);
                if (task) {
                    task.status = 'PENDING';
                    if (combinedSummary && !task.summary.includes(combinedSummary)) task.summary += `\n${combinedSummary}`;
                }
            } else {
                canvas.task_status.status = 'PENDING';
                if (combinedSummary && !canvas.task_status.summary.includes(combinedSummary)) canvas.task_status.summary += `\n${combinedSummary}`;
            }
            // [V3.7.2] 长耗时异步任务: TOOL_END 在后台 Promise 完成时记录，此处不标记
        } else if (combinedSummary) {
            // [V3.7.2] 同步任务完成: 记录 TOOL_END
            if (tracker) tracker.record('TOOL_END');
            // [V3.7.1] 同步任务也尝试走提纯链路
            if (this.onTaskReady && taskId) {
                await this.onTaskReady(callId, taskId, combinedSummary, tracker);  // [V3.7.2] 传递 tracker
            } else {
                await this.transitionToReady(canvas, combinedSummary, canvasManager, callId, taskId);
            }
        } else {
            // [V3.7.2] 无输出时也记录 TOOL_END
            if (tracker) tracker.record('TOOL_END');
        }
    }

    async transitionToReady(canvas: CanvasState, summary: any, canvasManager: CanvasManager, callId: string, taskId?: string): Promise<void> {
        let status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED' = 'READY';
        await canvasManager.updateTask(callId, taskId || canvas.task_status.taskId || "", { summary, status: status as any });
    }
}
