import { CanvasManager } from '../canvas-manager';

/**
 * [V3.5.0] IFastSkill (Skill-as-a-Tool)
 * 标准化技能接口，对标 OpenAI Tool Calling 并适配异步执行
 */
export interface IFastSkill {
    /** 技能的唯一英文标识符（必须符合 OpenAI 命名规范 /[a-zA-Z0-9_-]+/ ） */
    name: string;
    /** 告诉 SLE 模型什么时候该调用这个技能、解决什么专业问题 */
    description: string;
    /** 符合 OpenAI Tool Calling 规范的参数 JSON Schema */
    parameters: any;
    /** 标识此技能是否为耗时型（例如 RAG、外部 API），若为 true，系统将启用非阻塞执行模式 */
    isLongRunning?: boolean;
    
    /**
     * 真正执行外部请求或耗时操作的方法。
     * @param args 模型推论出的工具参数
     * @param callId 会话 ID
     * @param canvasManager 画布管理器
     * @returns 供最终系统压缩归档的响应文本 (注意：Phase 1 暂时维持同步调用返回)
     */
    execute(args: any, callId: string, canvasManager: CanvasManager): Promise<string>;
}
