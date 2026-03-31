export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge' | 'chat' | 'internal' | 'idle' | 'waiting';
    trace?: string[];
}

export type SLEScenario = 'ROUTING' | 'DECIDING' | 'PERSONA_REFRESH' | 'SUMMARIZING' | 'ASR_CORRECTION';

export interface CanvasState {
    env: { time: string; weather: string };
    task_status: {
        taskId?: string; // [V3.6.21] 为每次任务生成唯一追踪 ID，防止异步竞争 clobber 前置状态
        status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED';
        version: number;
        current_progress: number;
        importance_score: number;
        is_delivered: boolean;
        summary: string;
        direct_response?: string;
        extended_context?: string;
        extracted_data?: string;
    };
    context: {
        last_spoken_fragment: string;
        interrupted: boolean;
        last_interaction_time: number;
        is_busy: boolean;
        idle_trigger_count?: number; // [V3.6.16] 追踪当前闲置期内已触发唤醒的次数
    };
}

export interface IFastAgent {
    process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string, trace?: string[]) => Promise<void>,
        callIdOverride?: string
    ): Promise<boolean>;
    destroySession(callId: string): void;
    destroy(): void;
}
