import type { ZegoConfig, LlmConfig, AsrConfig, TtsConfig } from '../types/config';
interface RegisterAgentParams {
    llmUrl: string;
    llm: LlmConfig;
    tts: TtsConfig;
    asr?: AsrConfig;
}
/**
 * 封装与 ZEGO AI Agent Server 交互的类
 */
export declare class ZegoApiClient {
    private baseUrl;
    private appId;
    private serverSecret;
    private agentId;
    constructor(config: ZegoConfig);
    /**
     * 构建包含签名信息的公共 Query 参数
     */
    private buildAuthQueryParams;
    /**
     * 发送 POST 请求到 ZEGO Server
     */
    private post;
    /**
     * 注册/更新智能体配置 (仅在 Plugin 启动时调用一次)
     */
    registerAgent(params: RegisterAgentParams): Promise<void>;
    /**
     * 为具体的一通电话创建智能体实例
     */
    createAgentInstance(rtcRoomId: string, rtcUserId: string, rtcStreamId: string): Promise<string>;
    /**
     * 电话挂断时，删除实例清理资源
     */
    deleteAgentInstance(agentInstanceId: string): Promise<any>;
    /**
     * 主动下发 TTS 语音消息给客户端
     */
    sendAgentInstanceTTS(agentInstanceId: string, text: string, priority?: 'Low' | 'Medium' | 'High', samePriorityOption?: 'ClearAndInterrupt' | 'Enqueue'): Promise<any>;
}
export {};
