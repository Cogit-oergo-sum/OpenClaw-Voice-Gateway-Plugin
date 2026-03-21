import { DelegateExecutor } from './executor';
import { ResultSummarizer } from './result-summarizer';
import { CanvasManager } from './canvas-manager';
import { CanvasState } from './types';
import { CallManager } from '../call/call-manager';
import { ASR_CORRECTION_DIRECTIVE_TEMPLATE } from './prompts';

/**
 * [V3.3.0] ToolResultHandler: 工具执行结果处理器
 * 职责：执行工具调用、解析结果、统一 Canvas 状态转换
 */
export class ToolResultHandler {
    constructor(
        private executor: DelegateExecutor,
        private summarizer: ResultSummarizer,
        private callManager?: CallManager
    ) {}

    /**
     * 处理工具调用结果并更新 Canvas 状态
     */
    async handleToolCalls(
        toolCalls: any[],
        text: string,
        callId: string,
        canvas: CanvasState,
        canvasManager: CanvasManager
    ): Promise<void> {
        for (const tc of toolCalls) {
            const args = JSON.parse(tc.function.arguments || '{}');
            const intent = args.intent || text;

            canvas.task_status.status = 'PENDING';
            canvas.task_status.version = Date.now();
            canvas.task_status.direct_response = "";
            canvas.task_status.extended_context = "";
            canvas.task_status.summary = `正在同步执行意图: ${intent}...`;
            await canvasManager.logCanvasEvent(callId, 'CANVAS_PENDING', { intent });

            try {
                if (tc.function.name === 'correct_asr_hotword') {
                    const { wrong, correct } = args;
                    if (this.callManager) {
                        const call = this.callManager.getCallState(callId);
                        const alreadyCorrected = call?.aliasMap.get(wrong) === correct;

                        await this.callManager.updateAsrCorrection(callId, wrong, correct);

                        // [V3.4.4] 权力下放：不再硬编码播报文案，而是通过潜意识指令引导 AI 自由发挥
                        if (!alreadyCorrected) {
                            const directive = ASR_CORRECTION_DIRECTIVE_TEMPLATE(wrong, correct);
                            await this.transitionToReady(canvas, directive, canvasManager, callId, 'ASR_CORRECTED');
                        } else {
                            // 虽然不更新画布摘要，但仍持久化日志以便可观测
                            await canvasManager.logCanvasEvent(callId, 'ASR_ALREADY_FIXED', { wrong, correct });
                        }
                    }
                    continue;
                }

                const raceResult = await this.executor.executeOpenClaw(callId, intent);

                if (raceResult.isTimeout) {
                    if (raceResult._pendingPromise) {
                        this.executor.waitAndParse(raceResult._pendingPromise).then(async (finalResult) => {
                            const rawOut = finalResult.stdout || (finalResult.stderr ? `错误: ${finalResult.stderr}` : "任务完成。");
                            const summary = await this.summarizer.summarizeTaskResult(rawOut, intent);

                            if (finalResult.parsedData?.task_status) {
                                Object.assign(canvas.task_status, finalResult.parsedData.task_status);
                            }
                            await this.transitionToReady(canvas, summary, canvasManager, callId);
                        }).catch(e => {
                            console.error(`[SLE Background Error] ${e}`);
                            this.transitionToReady(canvas, `任务执行出错: ${e.message}`, canvasManager, callId, 'CANVAS_CLI_ERROR');
                        });
                    }
                } else {
                    let result = "";
                    const data = raceResult.parsedData;
                    if (data) {
                        result = (data.result?.payloads && data.result.payloads[0]?.text)
                            || (data.payloads && data.payloads[0]?.text)
                            || data.content || data.message || JSON.stringify(data);
                        if (data.task_status) {
                            Object.assign(canvas.task_status, data.task_status);
                            await canvasManager.logCanvasEvent(callId, 'CANVAS_CLI_SYNC', { status: data.task_status.status });
                        }
                    } else {
                        result = raceResult.stdout.replace(/HEARTBEAT_OK/g, '').trim();
                        if (!result && raceResult.stderr) {
                            result = `执行失败: ${raceResult.stderr.split('\n')[0]}`;
                        } else if (!result) {
                            result = "已按指令处理妥当。";
                        }
                    }
                    await this.transitionToReady(canvas, result, canvasManager, callId);
                }
            } catch (e: any) {
                console.error(`[SLE Tool Error] ${e.message}`);
                await this.transitionToReady(canvas, `工具执行失败: ${e.message}`, canvasManager, callId, 'CANVAS_CLI_ERROR');
            }
        }
    }

    /**
     * 统一状态转换：将 Canvas 状态更新为 READY
     */
    async transitionToReady(
        canvas: CanvasState,
        summary: string | { direct_response: string; extended_context: string },
        canvasManager: CanvasManager,
        callId: string,
        eventName: string = 'CANVAS_CLI_READY'
    ): Promise<void> {
        if (typeof summary === 'string') {
            canvas.task_status.summary = summary;
            canvas.task_status.direct_response = summary;
        } else {
            canvas.task_status.direct_response = summary.direct_response;
            canvas.task_status.extended_context = summary.extended_context;
            canvas.task_status.summary = `${summary.direct_response}\n${summary.extended_context}`;
        }
        canvas.task_status.status = 'READY';
        canvas.task_status.version = Date.now();
        canvas.task_status.is_delivered = false;
        // 默认重要性分数为 1.0 (如果业务逻辑没覆盖它)
        if (canvas.task_status.importance_score === undefined || canvas.task_status.importance_score === 0) {
            canvas.task_status.importance_score = 1.0;
        }
        await canvasManager.logCanvasEvent(callId, eventName, { summary });
    }
}
