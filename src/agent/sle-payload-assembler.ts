import { SLEScenario } from './types';
import { 
    INTENT_ROUTER_SYSTEM_PROMPT, 
    LOGIC_EXPERT_IDENTITY, 
    SLE_ACTION_PROTOCOL, 
    PERSONA_SYNTHESIZER_PROMPT, 
    TASK_RESULT_SUMMARIZER_SYSTEM, 
    SLE_ASR_CORRECTION_PROTOCOL,
    ASR_CORRECTION_JUDGMENT_PROMPT,
    buildShadowThought
} from './prompts';

export class SLEPayloadAssembler {
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
        }
    ): Promise<Array<{ role: string; content: string }>> {
        switch (scenario) {
            case 'ROUTING':
                const routingContext = `[Context] 画布: ${params.canvasSnapshot || '{}'}; 摘要: ${params.recentHistorySummary || '无'}`;
                const routingUserContent = params.text ? `${routingContext}\n\n[Input] ${params.text}` : routingContext;
                return [
                    { role: 'system', content: INTENT_ROUTER_SYSTEM_PROMPT(skills_summary) },
                    { role: 'user', content: routingUserContent }
                ];
            case 'DECIDING':
                const decidingSystemContent = `${LOGIC_EXPERT_IDENTITY}\n${SLE_ACTION_PROTOCOL}`;
                const snapshotStr = `[Canvas Snapshot] ${params.canvasSnapshot || '{}'}; [Intent Hint] ${params.current_intent || '无'}`;
                
                // [V3.6.4] Memory Purification: Flatten Snapshot, History, and Input into ONE user message 
                // to prevent logicExpert from being distracted by chat-style multi-turn messages.
                const dialogueHistory = (params.dialogueHistory || []).slice(-5);
                const historyText = dialogueHistory.map(m => ` - [${m.role.toUpperCase()}]: ${m.content}`).join('\n');
                const historyBlock = historyText ? `[Recent History]:\n${historyText}` : '[Recent History]: 无';
                
                const currentText = params.text || '';
                const isTrigger = currentText === '__INTERNAL_TRIGGER__' || currentText === '__IDLE_TRIGGER__';
                const inputBlock = (currentText && !isTrigger) 
                    ? `[Current Input]: ${currentText}` 
                    : '[Current Input]: 无 (系统任务或闲置唤醒)';

                const unifiedUserContent = `${snapshotStr}\n\n${historyBlock}\n\n${inputBlock}`;

                return [
                    { role: 'system', content: decidingSystemContent },
                    { role: 'user', content: unifiedUserContent }
                ];
            case 'PERSONA_REFRESH':
                return [
                    { role: 'system', content: PERSONA_SYNTHESIZER_PROMPT },
                    { role: 'user', content: params.fullPersonaContext || '' }
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
