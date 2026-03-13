import { generateZegoAuth } from './zego-auth';
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
export class ZegoApiClient {
    private baseUrl: string;
    private appId: number;
    private serverSecret: string;
    private agentId: string = 'openclaw_voice_agent_v9';

    constructor(config: ZegoConfig) {
        this.baseUrl = config.aiAgentBaseUrl;
        this.appId = config.appId;
        this.serverSecret = config.serverSecret;
    }

    /**
     * 构建包含签名信息的公共 Query 参数
     */
    private buildAuthQueryParams(): string {
        const auth = generateZegoAuth(this.appId, this.serverSecret);
        return `?AppId=${this.appId}&SignatureNonce=${auth.nonce}&Timestamp=${auth.timestamp}&Signature=${auth.signature}&SignatureVersion=2.0`;
    }

    /**
     * 发送 POST 请求到 ZEGO Server
     */
    private async post<T>(action: string, payload: any): Promise<T> {
        const url = `${this.baseUrl}/${this.buildAuthQueryParams()}&Action=${action}`;

        try {
            console.log(`[ZegoApiClient] Calling ${action} with Payload:`, JSON.stringify(payload, null, 2));
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                const errText = await response.text();
                console.error(`[ZegoApiClient] HTTP ${response.status}: ${errText}`);
                throw new Error(`ZEGO API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (data.Code !== 0) {
                throw new Error(`ZEGO API Error: code=${data.Code}, msg=${data.Message}`);
            }

            return data.Data as T;
        } catch (error) {
            console.error(`[ZegoApiClient] ${action} failed:`, error);
            throw error;
        }
    }

    /**
     * 注册智能体配置
     */
    async registerAgent(params: RegisterAgentParams): Promise<void> {
        const payload: any = {
            AgentId: this.agentId,
            Name: 'OpenClaw Voice Agent',
            LLM: {
                Url: params.llmUrl,
                ApiKey: params.llm.apiKey,
                Model: params.llm.model,
                BaseUrl: params.llm.baseUrl,
                AddAgentInfo: true
            },
            TTS: {
                Vendor: params.tts.vendor,
                Params: {
                    app: { appid: params.tts.appId, token: params.tts.token, cluster: "volcano_tts" },
                    audio: { voice_type: params.tts.voiceType }
                }
            }
        };

        if (params.asr) {
            payload.ASR = {
                Vendor: params.asr.vendor,
                Params: params.asr.params,
                VadSilenceSegmentation: params.asr.vadSilenceSegmentation
            };
        }

        await this.post('RegisterAgent', payload);
        console.log(`[ZegoApiClient] Agent registered: ${this.agentId}`);
    }

    /**
     * 更新智能体配置
     */
    async updateAgent(params: RegisterAgentParams): Promise<void> {
        const payload: any = {
            AgentId: this.agentId,
            Name: 'OpenClaw Voice Agent',
            LLM: {
                Url: params.llmUrl,
                ApiKey: params.llm.apiKey,
                Model: params.llm.model,
                BaseUrl: params.llm.baseUrl,
                AddAgentInfo: true
            },
            TTS: {
                Vendor: params.tts.vendor,
                Params: {
                    app: { appid: params.tts.appId, token: params.tts.token, cluster: "volcano_tts" },
                    audio: { voice_type: params.tts.voiceType }
                }
            }
        };

        if (params.asr) {
            payload.ASR = {
                Vendor: params.asr.vendor,
                Params: params.asr.params,
                VadSilenceSegmentation: params.asr.vadSilenceSegmentation
            };
        }

        await this.post('UpdateAgent', payload);
        console.log(`[ZegoApiClient] Agent updated: ${this.agentId}`);
    }

    /**
     * 为具体的一通电话创建智能体实例
     */
    async createAgentInstance(rtcRoomId: string, rtcUserId: string, agentStreamId: string, userStreamId: string): Promise<string> {
        const payload = {
            AgentId: this.agentId,
            UserId: rtcUserId,
            RTC: {
                RoomId: rtcRoomId,
                AgentUserId: 'openclaw_voice_agent',
                AgentStreamId: agentStreamId,
                UserStreamId: userStreamId
            }
        };

        const result = await this.post<{ AgentInstanceId: string }>('CreateAgentInstance', payload);
        return result.AgentInstanceId;
    }

    /**
     * 电话挂断时，删除实例清理资源
     */
    async deleteAgentInstance(agentInstanceId: string): Promise<any> {
        const payload = {
            AgentInstanceId: agentInstanceId
        };
        // 返回包含统计数据的对象
        return await this.post<any>('DeleteAgentInstance', payload);
    }

    /**
     * 主动下发 TTS 语音消息给客户端
     */
    async sendAgentInstanceTTS(agentInstanceId: string, text: string, priority: 'Low' | 'Medium' | 'High' = 'Medium', samePriorityOption: 'ClearAndInterrupt' | 'Enqueue' = 'ClearAndInterrupt'): Promise<any> {
        const payload = {
            AgentInstanceId: agentInstanceId,
            Text: text.slice(0, 300), // 限制最大 300 字符
            Record: true,
            Priority: priority,
            SamePriorityOption: samePriorityOption
        };
        return await this.post<any>('SendAgentInstanceTTS', payload);
    }
}
