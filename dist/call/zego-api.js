"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ZegoApiClient = void 0;
const zego_auth_1 = require("./zego-auth");
/**
 * 封装与 ZEGO AI Agent Server 交互的类
 */
class ZegoApiClient {
    baseUrl;
    appId;
    serverSecret;
    agentId = 'openclaw_voice_agent';
    constructor(config) {
        this.baseUrl = config.aiAgentBaseUrl;
        this.appId = config.appId;
        this.serverSecret = config.serverSecret;
    }
    /**
     * 构建包含签名信息的公共 Query 参数
     */
    buildAuthQueryParams() {
        const auth = (0, zego_auth_1.generateZegoAuth)(this.appId, this.serverSecret);
        return `?AppId=${this.appId}&SignatureNonce=${auth.nonce}&Timestamp=${auth.timestamp}&Signature=${auth.signature}`;
    }
    /**
     * 发送 POST 请求到 ZEGO Server
     */
    async post(action, payload) {
        const url = `${this.baseUrl}/${action}${this.buildAuthQueryParams()}`;
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload)
            });
            if (!response.ok) {
                throw new Error(`ZEGO API Error: ${response.status} ${response.statusText}`);
            }
            const data = await response.json();
            if (data.Code !== 0) {
                throw new Error(`ZEGO API Error: code=${data.Code}, msg=${data.Message}`);
            }
            return data.Data;
        }
        catch (error) {
            console.error(`[ZegoApiClient] ${action} failed:`, error);
            throw error;
        }
    }
    /**
     * 注册/更新智能体配置 (仅在 Plugin 启动时调用一次)
     */
    async registerAgent(params) {
        const payload = {
            AgentId: this.agentId,
            Name: 'OpenClaw Voice Agent',
            LLM: {
                Url: params.llmUrl,
                ApiKey: params.llm.apiKey,
                Model: params.llm.model,
                BaseUrl: params.llm.baseUrl,
                AddAgentInfo: true // 告诉 ZEGO把 user_id, stream_id 等信息在请求大模型时带过来
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
     * 为具体的一通电话创建智能体实例
     */
    async createAgentInstance(rtcRoomId, rtcUserId, rtcStreamId) {
        const payload = {
            AgentId: this.agentId,
            RTC: {
                RoomId: rtcRoomId,
                UserId: rtcUserId,
                StreamId: rtcStreamId
            }
        };
        const result = await this.post('CreateAgentInstance', payload);
        return result.AgentInstanceId;
    }
    /**
     * 电话挂断时，删除实例清理资源
     */
    async deleteAgentInstance(agentInstanceId) {
        const payload = {
            AgentInstanceId: agentInstanceId
        };
        // 返回包含统计数据的对象
        return await this.post('DeleteAgentInstance', payload);
    }
    /**
     * 主动下发 TTS 语音消息给客户端
     */
    async sendAgentInstanceTTS(agentInstanceId, text, priority = 'Medium', samePriorityOption = 'ClearAndInterrupt') {
        const payload = {
            AgentInstanceId: agentInstanceId,
            Text: text.slice(0, 300), // 限制最大 300 字符
            Record: true,
            Priority: priority,
            SamePriorityOption: samePriorityOption
        };
        return await this.post('SendAgentInstanceTTS', payload);
    }
}
exports.ZegoApiClient = ZegoApiClient;
