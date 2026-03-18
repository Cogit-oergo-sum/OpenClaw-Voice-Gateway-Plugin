export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge';
}

export interface IFastAgent {
    process(
        messages: any[], 
        onChunk: (resp: FastAgentResponse) => void,
        notifier?: (text: string) => Promise<void>
    ): Promise<void>;
    destroy(): void;
}
