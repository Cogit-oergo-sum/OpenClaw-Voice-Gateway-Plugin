import { IFastSkill } from '../iskill';
import { CanvasManager } from '../../canvas-manager';
import { ASR_CORRECTION_DIRECTIVE_TEMPLATE } from '../../prompts';
import { CallManager } from '../../../call/call-manager';

/**
 * [V3.5.3] AsrCorrectionSkill: 内核级 ASR 纠错工具
 * 职责：同步执行 ASR 错误词识别与 Canvas 潜意识注入，并同步 ZEGO 热词。
 */
export class AsrCorrectionSkill implements IFastSkill {
    name = 'correct_asr_hotword';
    description = '用于纠正 ASR 语音识别中的同音词或语义错误。当你发现 ASR 识别结果中存在逻辑不通的词汇（如将“极客”听成“即刻”）时，请调用此工具进行纠正。';
    parameters = {
        type: 'object',
        properties: {
            original_word: { type: 'string', description: 'ASR 识别出来的错误词汇' },
            corrected_word: { type: 'string', description: '根据语境推论出的正确词汇' }
        },
        required: ['original_word', 'corrected_word']
    };
    isLongRunning = false; // 内核级极速同步工具

    constructor(private callManager?: CallManager) {}

    async execute(args: { original_word: string; corrected_word: string }, callId: string, canvasManager: CanvasManager): Promise<string> {
        const { original_word, corrected_word } = args;

        // [V3.6.26] 健壮性校验：防止因逻辑补救失效产生 undefined 数据污染 Canvas
        if (!original_word || !corrected_word || corrected_word === 'undefined') {
            const errorMsg = `ASR 纠错失败：无效词汇 [${original_word} -> ${corrected_word}]。`;
            console.warn(`[AsrCorrectionSkill] ⚠️ ${errorMsg}`);
            return errorMsg;
        }
        
        // [V3.4.0] 冗余检查：如果该词已经纠正过且映射一致，则静默同步，不再重复触发 Canvas UI 事件
        const call = this.callManager?.getCallState(callId);
        if (call && call.aliasMap.get(original_word) === corrected_word) {
            // 仍同步到 ZEGO 以触发阶梯式提权 (Staircase Weighting)
            if (this.callManager) {
                await this.callManager.updateAsrCorrection(callId, original_word, corrected_word);
            }
            await canvasManager.logCanvasEvent(callId, 'ASR_ALREADY_FIXED', { 
                wrong: original_word, 
                correct: corrected_word 
            });
            return `ASR 纠错情报已同步 (静默模式)。`;
        }
        
        // 1. 同步热词到 ZEGO (核心能力)
        if (this.callManager) {
            try {
                await this.callManager.updateAsrCorrection(callId, original_word, corrected_word);
            } catch (e: any) {
                console.error(`[AsrCorrectionSkill] ZEGO 热词同步失败: ${e.message}`);
            }
        }

        // 2. 生成潜意识指令
        const directive = ASR_CORRECTION_DIRECTIVE_TEMPLATE(original_word, corrected_word);
        
        // 3. 注入 Canvas
        const canvas = canvasManager.getCanvas(callId);
        // 纠错应具有较低的重要性权重，避免触发 SLC 的主动播报
        canvas.task_status.importance_score = 0.5;
        canvas.task_status.summary = (canvas.task_status.summary || '') + `\n${directive}`;
        canvas.task_status.version = Date.now();
        
        // 4. 记录日志
        await canvasManager.logCanvasEvent(callId, 'ASR_CORRECTED', { 
            wrong: original_word, 
            correct: corrected_word 
        });

        return `已记录 ASR 纠错：${original_word} -> ${corrected_word}。纠错细节已注入潜意识，无须口头确认。`;
    }
}
