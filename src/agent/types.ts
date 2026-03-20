export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge' | 'chat' | 'internal' | 'idle' | 'waiting';
    trace?: string[];
}

export interface CanvasState {
    env: { time: string; weather: string };
    task_status: {
        status: 'READY' | 'PENDING';
        version: number;
        current_progress: number;
        importance_score: number;
        is_delivered: boolean;
        summary: string;
        extracted_data?: string;
    };
    context: {
        last_spoken_fragment: string;
        interrupted: boolean;
        last_interaction_time: number;
    };
}

export interface IFastAgent {
    process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string, trace?: string[]) => Promise<void>,
        callIdOverride?: string
    ): Promise<void>;
    destroy(): void;
}
