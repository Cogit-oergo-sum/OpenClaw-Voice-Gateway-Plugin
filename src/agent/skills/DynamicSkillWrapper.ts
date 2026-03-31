import { IFastSkill } from './iskill';
import { CanvasManager } from '../canvas-manager';
import axios from 'axios';

/**
 * [V3.5.0] DynamicSkillWrapper: 声明式技能包装器
 * 职责：将 YAML 定义的技能转码成 IFastSkill 接口，并执行远程 MCP/HTTP 调用。
 */
export class DynamicSkillWrapper implements IFastSkill {
    public name: string;
    public description: string;
    public parameters: any;
    public isLongRunning: boolean;
    public runtime: string = 'mcp';
    private endpoint: string;
    private method: string = 'POST';

    constructor(config: {
        name: string;
        description: string;
        parameters: any;
        isLongRunning?: boolean;
        runtime?: string;
        endpoint?: string;
        method?: string;
    }) {
        this.name = config.name;
        this.description = config.description;
        this.parameters = config.parameters || { type: 'object', properties: {} };
        this.isLongRunning = config.isLongRunning ?? false;
        this.runtime = config.runtime || 'mcp';
        this.endpoint = config.endpoint || '';
        this.method = config.method || 'POST';
    }

    /**
     * [V3.5.3] 真实的 Endpoint 派发执行
     */
    async execute(args: any, callId: string, canvasManager: CanvasManager): Promise<string> {
        console.log(`[DynamicSkillWrapper] 正在执行技能: ${this.name} (runtime: ${this.runtime})`);

        if (this.runtime === 'native') {
            const { SkillRegistry } = await import('./index');
            const handler = SkillRegistry.getInstance().getNativeHandler(this.name);
            
            if (handler) {
                console.log(`[DynamicSkillWrapper] 命中本地路由分支: ${this.name}`);
                try {
                    return await handler(args, callId, canvasManager);
                } catch (e: any) {
                    console.error(`[DynamicSkillWrapper Native Error] ${this.name}: ${e.message}`);
                    throw e;
                }
            } else {
                const errMsg = `Native handler for ${this.name} not found in SkillRegistry`;
                console.error(`[DynamicSkillWrapper Error] ${errMsg}`);
                return `错误: ${errMsg}`;
            }
        }
        
        if (!this.endpoint) {
            return `错误: 技能 ${this.name} 未配置端点 (endpoint)`;
        }

        try {
            // [V3.5.3] 根据 YAML 提取的 URL 发送真实请求
            const response = await axios({
                url: this.endpoint,
                method: this.method,
                data: args,
                timeout: 10000 // 10s 超时
            });

            console.log(`[DynamicSkillWrapper] 请求成功, 收到数据长度: ${JSON.stringify(response.data).length}`);
            
            // 返回原始结果，后续由 ToolResultHandler 配合 Summarizer 处理
            return typeof response.data === 'string' 
                ? response.data 
                : JSON.stringify(response.data, null, 2);

        } catch (e: any) {
            const errMsg = e.response?.data 
                ? (typeof e.response.data === 'string' ? e.response.data : JSON.stringify(e.response.data))
                : e.message;
            console.error(`[DynamicSkillWrapper Error] ${this.name}: ${errMsg}`);
            throw new Error(`远程服务调用失败: ${errMsg}`);
        }
    }
}
