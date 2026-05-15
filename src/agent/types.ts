export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge' | 'chat' | 'internal' | 'idle' | 'waiting' | 'mode_update' | 'sle_check'; // [V4.3] 增加 sle_check 用于前端感知 SLE 校验状态
    trace?: string[];
    perf?: any; // [V3.7.2] 耗时统计数据
    mode?: string; // [V4.1] 当前对话模式名称
    modeDescription?: string; // [V4.1] 当前对话模式描述（用于前端展示）
}

export type SLEScenario = 'ROUTING' | 'DECIDING' | 'REFINING' | 'SUMMARIZING' | 'ASR_CORRECTION';

export interface TaskItem {
    id: string;              // 唯一任务 ID (如 "t_01")
    name: string;            // 任务名称
    status: 'PENDING' | 'READY' | 'COMPLETED' | 'FAILED' | 'CANCELLED' | 'AWAITING_CONFIRMATION'; // [V3.10] 增加 AWAITING_CONFIRMATION
    stage?: string;          // 执行子阶段 (如 "MOVING_FILES")
    progress?: number;       // [3.7] 进度百分比
    progress_detail?: string; // [3.7] 进度短描
    summary: string;
    direct_response?: string;  // SLC 可直接播报的净化摘要
    extended_context?: string; // 追问时查阅的扩展上下文
    importance_score: number;  // Watchdog 播报分级阈值 (1-10)
    is_delivered: boolean;
    created_at: number;
    completed_at?: number;   // 完结时间戳 (供 TTL 清理)
    updated_at: number;      // [V3.7.1] 最近更新时间戳
    version: number;         // [3.7] 内部版本号，用于冲突检测
    tool_agent_id?: string;  // [V3.10] openClaw Agent ID，用于多轮交互上下文保持
    pending_questions?: string[]; // [V3.10] 工具主动发起的提问，需用户确认
}

export interface CanvasState {
    env: { time: string; weather: string };
    task_status: {
        taskId?: string; // [V3.6.21] 为每次任务生成唯一追踪 ID，防止异步竞争 clobber 前置状态
        status: 'READY' | 'PENDING' | 'COMPLETED' | 'FAILED' | 'AWAITING_CONFIRMATION'; // [V3.10] 增加 AWAITING_CONFIRMATION
        version: number;
        current_progress: number;
        importance_score: number;
        is_delivered: boolean;
        summary: string;
        direct_response?: string;
        extended_context?: string;
        extracted_data?: string;
    };
    tasks: TaskItem[];   // [V3.7] 多任务阵列
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

// Router 输出协议（设计文档 3.2 节附录定义）
export type IntentType = 'NEW_TASK' | 'CANCEL_TASK' | 'CLARIFY' | 'SCHEDULE_TASK' | 'CONFIRM_TASK' | 'SET_IMPORTANCE'; // [V3.11] 增加 SET_IMPORTANCE

/**
 * [V3.9] ScheduleItem: 定时任务条目
 */
export interface ScheduleItem {
    id: string;
    task_name: string;
    query: string;
    cron?: string;           // 标准 cron 表达式 (如 "0 8 * * *")
    time_point?: number;     // 单次触发的时间戳
    created_at: number;
    callId: string;
}


export interface IntentItem {
    intent_id: string;
    type: IntentType;
    tool?: string;           // NEW_TASK 时必填
    task_name?: string;      // NEW_TASK 时必填
    query?: string;          // NEW_TASK 时必填
    target_task_id?: string; // CANCEL_TASK 时必填
    depends_on?: string;     // 可选，串联依赖（Phase 4 使用）
    schedule?: string;       // 【V3.9】定时描述 (如 "每天早上8点", "下午3点")
    cron?: string;           // LLM 生成的标准 cron
    time?: string;           // LLM 生成的 ISO 时间或偏移
    message?: string;        // CLARIFY 时必填
    confirmation_response?: string; // [V3.10] CONFIRM_TASK 时，用户对 pending_questions 的回答
    task_type?: string;      // [V3.11] SET_IMPORTANCE 时，任务类型
    score?: number;          // [V3.11] SET_IMPORTANCE 时，优先级分数 (1-10)
}

/** @deprecated [V4.0] 已弃用，使用 RouterResultLite 替代 */
export interface RouterResult {
    intents: IntentItem[];
    isAnswerInActiveCanvas: boolean;
    isAnswerInArchiveMemory: boolean;
    matched_task_ids: string[];
}

/**
 * [V4.0] RouterResultLite: 极简路由结果
 */
export interface RouterResultLite {
    type: 'chat' | 'canvas' | 'task';
    matchedTaskIds?: string[];
    matchedSkill?: string;
}
