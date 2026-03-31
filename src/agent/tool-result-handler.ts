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
        registry.loadFromDirectory(path.join(this.workspaceRoot, 'skills'));
    }

    private lastHandledVersions: Map<string, number> = new Map();
    private lastSummarizedOutputs: Map<string, string> = new Map();
    private activeMonitors: Set<string> = new Set();

    async handleToolCalls(toolCalls: any[], text: string, callId: string, canvas: CanvasState, canvasManager: CanvasManager, taskId?: string): Promise<void> {
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
        canvas.task_status.status = 'PENDING';
        canvas.task_status.summary = `正在同步执行复合工作流: ${intents.join(' + ')}...`;
        await canvasManager.logCanvasEvent(callId, 'CANVAS_PENDING_MULTI', { intents });

        for (const tc of sortedTools) {
            const args = JSON.parse(tc.function.arguments || '{}');
            const command = args.command || args.intent || args.query || text;
            const skill = registry.getSkill(tc.function.name);
            if (!skill) continue;

            try {
                if (skill.isLongRunning) {
                    hasLongRunning = true;
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
                        this.lastHandledVersions.set(monitorId, canvas.task_status.version);
                        this.lastSummarizedOutputs.set(monitorId, canvas.task_status.summary);
                        
                        // 2. 启动执行并监听中间状态
                        const executionPromise = (skill as any).execute(args, callId, canvasManager, taskId);
                        
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
                                // 用“摘要自洽”比对代替“原始数据”比对，因为 appendCanvasAudit 会覆盖 summary
                                if (currentCanvas.task_status.status === 'PENDING' && 
                                    currentCanvas.task_status.version > lastVer &&
                                    currentCanvas.task_status.summary !== lastOut &&
                                    currentCanvas.task_status.summary !== ""
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
                        
                        // [V3.6.19] 关键修复：识别“后台启动”提示。
                        // 如果返回的是 TaskDelegateSkill 产生的后台挂起提示词，则维持 PENDING。
                        // 否则对于长耗时工具，Promise 完成即代表结果就绪 (READY)。
                        const isFinal = !raw.includes('任务已在后台启动'); 
                        
                        clearInterval(checkInterval);
                        // [V3.6.4] 关键优化：长耗时长最终结果不再此处调用 summarizer
                        // 而是直接写入 Canvas，由 Watchdog 触发 Orchestrator 的原子 SUMMARIZING 场景
                        // 这样既防止了双重 LLM 调用，也保证了逻辑专家对最终对白的绝对控制权
                        await canvasManager.appendCanvasAudit(callId, raw, isFinal ? 'READY' : 'PENDING', false, taskId);
                    }).catch(async e => {
                        console.error(`[ToolResultHandler] Long-running tool error:`, e);
                        await canvasManager.appendCanvasAudit(callId, `[${skill.name}] 任务执行异常: ${e.message}`, 'READY', false, taskId);
                    });
                } else {
                    combinedSummary += (combinedSummary ? "\n" : "") + await skill.execute(args, callId, canvasManager);
                }
            } catch (e: any) { combinedSummary += (combinedSummary ? "\n" : "") + `[${skill.name}] 失败: ${e.message}`; }
        }

        if (hasLongRunning) {
            canvas.task_status.status = 'PENDING';
            if (combinedSummary && !canvas.task_status.summary.includes(combinedSummary)) canvas.task_status.summary += `\n${combinedSummary}`;
        } else if (combinedSummary) {
            await this.transitionToReady(canvas, combinedSummary, canvasManager, callId);
        }
    }

    async transitionToReady(canvas: CanvasState, summary: any, canvasManager: CanvasManager, callId: string): Promise<void> {
        let status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED' = 'READY';
        if (typeof summary === 'string') {
            canvas.task_status.summary = summary;
            canvas.task_status.direct_response = summary;
        } else {
            canvas.task_status.direct_response = summary.direct_response;
            canvas.task_status.extended_context = summary.extended_context;
            canvas.task_status.summary = `${summary.direct_response}\n${summary.extended_context}`;
            if (summary.status) status = summary.status;
            if (typeof summary.importance_score === 'number' && summary.importance_score > 0) {
                canvas.task_status.importance_score = summary.importance_score;
            }
        }
        canvas.task_status.status = status;
        canvas.task_status.version = Date.now();
        canvas.task_status.is_delivered = false;
        if (!canvas.task_status.importance_score || canvas.task_status.importance_score === 0) canvas.task_status.importance_score = 5.0;
        await canvasManager.logCanvasEvent(callId, status === 'READY' || status === 'COMPLETED' ? 'CANVAS_CLI_READY' : 'CANVAS_PROGRESS_SYNC', { summary });
    }
}
