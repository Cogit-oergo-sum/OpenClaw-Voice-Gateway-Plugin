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
    /** 技能来源：'core'=内置核心技能（ASR纠错等），'external'=外部项目提供的技能 */
    source?: 'core' | 'external';
    
    /**
     * 真正执行外部请求或耗时操作的方法。
     * @param args 模型推论出的工具参数
     * @param callId 会话 ID
     * @param canvasManager 画布管理器
     * @param taskId 任务 ID
     * @param options 执行选项，包含 onTaskReady 回调用于异步接力路径触发 SUMMARIZING 提纯
     * @returns 供最终系统压缩归档的响应文本
     */
    execute(args: any, callId: string, canvasManager: CanvasManager, taskId?: string, options?: { signal?: AbortSignal; onTaskReady?: (callId: string, taskId: string, result: string) => Promise<void> }): Promise<string>;
}
