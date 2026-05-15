import { SLEScenario, TaskItem } from './types';
import {
    INTENT_ROUTER_SYSTEM_PROMPT,
    LOGIC_EXPERT_IDENTITY,
    SLE_ACTION_PROTOCOL,
    SLE_DECIDING_ENHANCED_PROMPT,
    PERSONA_SYNTHESIZER_PROMPT,
    TASK_RESULT_SUMMARIZER_SYSTEM,
    SLE_ASR_CORRECTION_PROTOCOL,
    ASR_CORRECTION_JUDGMENT_PROMPT,
    buildShadowThought
} from './prompts';

export class SLEPayloadAssembler {
    /**
     * [V4.0] 极简画布格式化
     */
    static formatCanvasForRouting(tasks: TaskItem[]): string {
        if (!tasks || tasks.length === 0) return '(无)';
        return tasks.map(t => `[${t.id}] ${t.name}`).join('\n');
    }

    /**
     * [V3.7] 详细画布格式化（用于 DECIDING 场景）
     */
    static formatCanvasForDeciding(tasks: TaskItem[]): string {
        if (!tasks || tasks.length === 0) return '(无活跃任务)';

        const statusMap: any = {
            'PENDING': '处理中',
            'READY': '待播报',
            'COMPLETED': '已完成',
            'FAILED': '已失败',
            'CANCELLED': '已取消',
            'AWAITING_CONFIRMATION': '等待确认'
        };

        return tasks.map(t => {
            const statusStr = statusMap[t.status] || t.status;
            let info = `任务: ${t.name} (状态: ${statusStr}, ID: ${t.id})`;
            if (t.status === 'PENDING') {
                info += `, 阶段 ${t.stage || '执行中'}, 进度 ${t.progress || 0}%`;
            }
            if (t.status === 'AWAITING_CONFIRMATION' && t.pending_questions?.length) {
                info += `, 待确认: ${t.pending_questions.join('、')}`;
            }
            const summary = t.summary ? t.summary.slice(0, 50).replace(/\n/g, ' ') : '无摘要';
            return `${info}: ${summary}...`;
        }).join('\n');
    }

    static async assemble(
        scenario: SLEScenario,
        callId: string,
        skills_summary: string,
        params: {
            text?: string;
            current_intent?: string;
            canvasSnapshot?: string;
            dialogueHistory?: any[];
            taskOutput?: string;
            taskIntent?: string;
            fullPersonaContext?: string;
            recentHistorySummary?: string;
            recentHistoryRaw?: string;
            skillsSummary?: string;
            modeContext?: { currentMode: string; modePromptSummary: string; switchConditions: string };  // [V4.7]
        }
    ): Promise<Array<{ role: string; content: string }>> {
        switch (scenario) {
            case 'ROUTING':
                // [V4.4] 极简路由：注入 Canvas + Skills，输出 "" | "y:task_id" | "t:skill_name"
                const tasks = JSON.parse(params.canvasSnapshot || '{"tasks":[]}').tasks || [];
                const canvasLite = this.formatCanvasForRouting(tasks);
                const skillsSummary = params.skillsSummary || '';
                const routingSystem = `${INTENT_ROUTER_SYSTEM_PROMPT(skillsSummary)}\n\n[Canvas]\n${canvasLite || '(无)'}`;
                return [
                    { role: 'system', content: routingSystem },
                    { role: 'user', content: params.text || '无输入' }
                ];
            case 'DECIDING':
                // [V4.0] 增强版 DECIDING：全意图判断
                const decidingSystemContent = `${LOGIC_EXPERT_IDENTITY}\n${SLE_DECIDING_ENHANCED_PROMPT}`;

                const decidingTasks = JSON.parse(params.canvasSnapshot || '{"tasks":[]}').tasks || [];
                const taskDisplay = this.formatCanvasForDeciding(decidingTasks);

                const snapshotStr = `[Focused Task Snapshot]:\n${taskDisplay}`;
                const intentHint = `[Intent Hint]: ${params.current_intent || '无'}`;
                const taskOutputBlock = params.taskOutput ? `[Current Task Progress/Output]:\n${params.taskOutput}` : '[Current Task Progress/Output]: (无)';

                const dialogueHistoryDeciding = (params.dialogueHistory || []).slice(-5);
                const historyTextDeciding = dialogueHistoryDeciding.map(m => ` - [${m.role.toUpperCase()}]: ${m.content}`).join('\n');
                const historyBlockDeciding = historyTextDeciding ? `[Recent History]:\n${historyTextDeciding}` : '[Recent History]: 无说明';

                const currentTextDeciding = params.text || '';
                const isTriggerDeciding = currentTextDeciding === '__INTERNAL_TRIGGER__' || currentTextDeciding === '__IDLE_TRIGGER__';
                const inputBlockDeciding = (currentTextDeciding && !isTriggerDeciding)
                    ? `[User Input]: ${currentTextDeciding}`
                    : '[User Input]: (系统内部或闲置触发)';

                // [V4.7] 模式跃迁上下文注入
                let modeContextBlock = '';
                if (params.modeContext) {
                    const mc = params.modeContext;
                    modeContextBlock = `[Current Mode Context]:
当前模式: ${mc.currentMode}
${mc.modePromptSummary ? `模式行为概要: ${mc.modePromptSummary}` : ''}
切换条件:
${mc.switchConditions}`;
                }

                const unifiedUserContentDeciding = `${modeContextBlock}\n\n${snapshotStr}\n\n${intentHint}\n\n${taskOutputBlock}\n\n${historyBlockDeciding}\n\n${inputBlockDeciding}`;

                return [
                    { role: 'system', content: decidingSystemContent },
                    { role: 'user', content: unifiedUserContentDeciding }
                ];
            case 'REFINING':
                return [
                    { role: 'system', content: PERSONA_SYNTHESIZER_PROMPT },
                    { role: 'user', content: `[Context]\n${params.fullPersonaContext || ''}\n\n[Refinement Intent]\n${params.current_intent || '进行常规的人设提炼与精简'}` }
                ];
            case 'SUMMARIZING':
                const sumUserContent = `[任务意图]: ${params.taskIntent || '未知'}\n[原始输出]: ${params.taskOutput || '无'}`;
                return [
                    { role: 'system', content: TASK_RESULT_SUMMARIZER_SYSTEM },
                    { role: 'user', content: sumUserContent }
                ];
            case 'ASR_CORRECTION':
                return [
                    { role: 'system', content: SLE_ASR_CORRECTION_PROTOCOL },
                    { role: 'user', content: ASR_CORRECTION_JUDGMENT_PROMPT(params.text || '', params.recentHistoryRaw || '') }
                ];
            default: return [];
        }
    }
}
