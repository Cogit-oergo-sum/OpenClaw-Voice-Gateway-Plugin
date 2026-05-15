import OpenAI from 'openai';
import { FastAgentResponse } from './types';
import { PluginConfig } from '../types/config';
import { PromptAssembler } from './prompt-assembler';
import { ShadowManager } from './shadow-manager';
import { getCurrentCallId } from '../context/ctx';
import { buildShadowThought, ShadowThoughtType } from './prompts';
import { LlmLogger } from '../utils/llm-logger';
import { CanvasManager } from './canvas-manager';
import { TextCleaner } from '../utils/text-cleaner';
import { ModeManager } from './mode-manager';

/**
 * [V4.3] trigger_sle_check 虚拟工具 Schema
 * SLC 调用此工具触发 SLE 意图校验
 */
const TRIGGER_SLE_CHECK_SCHEMA = {
    type: 'function' as const,
    function: {
        name: 'trigger_sle_check',
        description: '触发逻辑引擎(SLE)判断当前对话是否需要工具调用。当你认为可能需要查数据、执行操作时调用。',
        parameters: {
            type: 'object',
            properties: {
                reason: {
                    type: 'string',
                    description: '你认为可能需要工具的简短理由'
                }
            },
            required: ['reason']
        }
    }
};

/**
 * [V3.2.0] SLCEngine: 交互魂魄引擎
 * [V4.1] 扩展：支持 ModeManager 模式切换虚拟工具
 * 职责：极速响应、情绪共鸣、语意缝合
 */
export class SLCEngine {
    private slcClient: OpenAI;
    private modeManager: ModeManager | null = null;

    constructor(
        private config: PluginConfig,
        private promptAssembler: PromptAssembler,
        private canvasManager: CanvasManager
    ) {
        this.slcClient = new OpenAI({
            apiKey: config.fastAgent?.slcApiKey || config.llm.apiKey,
            baseURL: config.fastAgent?.slcBaseUrl || config.llm.baseUrl
        });
    }

    /**
     * [V4.1] 设置 ModeManager
     */
    setModeManager(manager: ModeManager): void {
        this.modeManager = manager;
    }

    /**
     * SLC (Soul-Light-Chat): 极速垫词与交互缝合
     */
    async run(
        text: string,
        lastSpokenFragment: string,
        tasks: import('./types').TaskItem[],
        shadowManager: ShadowManager,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        dialogueMessages: any[] = [],
        isNewSession: boolean = false,
        tracker?: any, // [V3.7.2] 显式透传 tracker
        preAssembledPrompt?: string, // [V3.7.2] 预组装的提示词，直接复用以节省耗时
        onToolCall?: (name: string, args: any) => void, // [V4.3] 虚拟工具调用回调（trigger_sle_check 等）
        enableSleCheck: boolean = true, // [V4.3] 控制是否暴露 trigger_sle_check 工具（Router 已判 task 时传 false）
        skillHint?: string // [V4.4] Router 匹配的 skill 名称，透传给潜意识
    ): Promise<string> {
        let slcFullText = "";
        try {
            const isInternal = text === '__INTERNAL_TRIGGER__';
            const isIdle = text === '__IDLE_TRIGGER__';
            const isWaiting = text === '__TOOL_WAITING_TRIGGER__';
            const isPolish = text === '__REPLY_POLISH_TRIGGER__';
 
            // [V3.6.10] 确定请求来源
            let source = 'User-Input';
            if (isInternal) source = 'Async-Result-Delivery';
            else if (isIdle) source = 'Watchdog-Idle';
            else if (isWaiting) source = 'Tool-Waiting';
            else if (isPolish) source = 'Reply-Polishing';
 
            const callId = getCurrentCallId() || 'global';
            const state = shadowManager.getOrCreateState(callId);
            const slcPrompt = preAssembledPrompt || await this.promptAssembler.assemblePrompt('SLC', callId, state, isNewSession);

            const messages: any[] = [
                { role: 'system', content: slcPrompt }
            ];

            // [V4.5] 模式提示词常驻注入：每轮都注入当前模式完整指引，确保行为准则持续生效
            const currentMode = this.modeManager ? (state.metadata.current_mode || this.modeManager.getInitialMode()) : '';

            if (this.modeManager && this.modeManager.hasMode(currentMode)) {
                const modePrompt = this.modeManager.getModePrompt(currentMode);
                if (modePrompt) {
                    messages.push({
                        role: 'user',
                        content: `[模式引导]\n${modePrompt}`
                    });
                    console.log(`[SLCEngine][${callId}] 注入模式提示词: ${currentMode}`);
                }
            }

            // 切换模式后清除待注入标记
            if (state.metadata.mode_pending_injection) {
                state.metadata.mode_pending_injection = null;
                state.metadata.mode_injected = currentMode;
            }

            // 补充历史记录 (SLC 现在作为对话灵魂，需要全量上下文)
            // [V4.6] 角色交替：遇到连续同 role 消息时插入翻转占位符，避免合并破坏时序语义导致模型重复输出
            const recentContext: any[] = [];
            const filteredHistory = dialogueMessages.filter(m => m.role === 'user' || m.role === 'assistant');

            for (const msg of filteredHistory) {
                if (recentContext.length > 0 && recentContext[recentContext.length - 1].role === msg.role) {
                    const oppositeRole = msg.role === 'user' ? 'assistant' : 'user';
                    recentContext.push({ role: oppositeRole, content: '…' });
                    recentContext.push({ ...msg });
                    continue;
                }
                recentContext.push({ ...msg });
            }
            messages.push(...recentContext);

            // [V3.7.1] 潜意识缝合逻辑升级：只要有任务达到就绪状态 (READY/COMPLETED/FAILED)，即触发结果交付汇报内容。
            let shadowThought = "";
            if (isInternal) {
                const isAnyDone = tasks.length > 0 && tasks.some(t => t.status === 'READY' || t.status === 'COMPLETED' || t.status === 'FAILED');
                const type: ShadowThoughtType = isAnyDone ? 'RESULT_DELIVERY' : 'PROGRESS_REPORT';
                shadowThought = buildShadowThought(type, tasks);
            } else if (isIdle) {
                shadowThought = buildShadowThought('idle', tasks);
            } else if (isWaiting) {
                shadowThought = buildShadowThought('PROGRESS_REPORT', tasks, skillHint);
            } else if (isPolish) {
                shadowThought = buildShadowThought('polishing', tasks);
            } else if (tasks.length > 0) {
                shadowThought = buildShadowThought('chat', tasks);
            }

            // [V4.5] 模式声明已由常驻 [模式引导] 覆盖，不再需要 ShadowThought 追加

            // [V3.9.1] 潜意识缝合逻辑全量升级为 Assistant Pre-fill (预填词引导)
            if (shadowThought) {
                if (isInternal || isIdle) {
                    let triggerPrompt = "";
                    if (isInternal) triggerPrompt = "任务有了新进展或完毕，请用一句话直接回答或播报结果。";
                    else if (isIdle) triggerPrompt = "冷场了，主动找个活泼点的话题跟用户聊聊。";
                    
                    // 确保严格的角色交替：如果历史记录末尾已经是 user，则追加；否则新增一个 user 触发消息
                    const lastMsg = messages[messages.length - 1];
                    if (lastMsg && lastMsg.role === 'user') {
                        lastMsg.content += "\n" + triggerPrompt;
                    } else {
                        messages.push({ role: 'user', content: triggerPrompt });
                    }
                }
                
                // 所有的潜意识 (ShadowThought) 统一作为 Assistant 角色进行前缀注入
                // 彻底移除 "[潜意识强制引导]：" 标签，让注入更加自然（Pre-fill 模式下模型会认为这是它自己的心流起点）
                messages.push({ role: 'assistant', content: shadowThought });
                
                // 为了调试可视化，将完整的潜意识作为首个 chunk 发送（过滤 shadow 标签，防止泄露到用户可见输出）
                const thoughtContentForDebug = shadowThought.replace(/<shadow>/g, '').replace(/<\/shadow>/g, '');
                onChunk({ content: `[thought]`, isFinal: false, type: 'thought' });
            }

            // [V3.6.2] FALLBACK-01: 增加对 OpenAI 推理流的超时拦截逻辑 (900ms)
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), this.config.advanced?.maxResponseTimeMs || 1500);

            const slcModel = this.config.fastAgent?.slcModel!;

            // [V3.7.2] 耗时追踪: SLC 开始
            if (tracker) tracker.record('SLC_START');

            // [V4.1] 构建 tools 参数（如果 ModeManager 可用）
            // [ARCH] func_tags 模式下不传 tools，SLC 用文本 FUNC 标签代替 FC
            const funcMode = process.env.VOICE_GATEWAY_ARCH_FUNC === 'func_tags';
            const modeSwitchSchema = this.modeManager?.getModeSwitchSchema();
            const fcTools = [modeSwitchSchema, enableSleCheck ? TRIGGER_SLE_CHECK_SCHEMA : null].filter(Boolean);
            const tools = funcMode ? [] : fcTools;

            // [V4.1 Debug] 打印 tools 参数，验证是否正确传递
            console.log(`[SLCEngine][${callId}] Tools parameter: ${tools.length > 0 ? JSON.stringify(tools, null, 2) : 'undefined (func_tags mode)'}`);
            console.log(`[SLCEngine][${callId}] ModeManager available: ${this.modeManager ? 'yes' : 'no'}, Schema valid: ${modeSwitchSchema ? 'yes' : 'no'}, funcMode: ${funcMode}`);
            LlmLogger.log({ source, scenario: 'SLC_TOOLS', callId, model: slcModel }, [], JSON.stringify({ tool_count: tools.length, tool_names: tools.map((t: any) => t?.function?.name), modeManager: !!this.modeManager, schemaValid: !!modeSwitchSchema, funcMode }));

            // [V4.2] DashScope 扩展参数：关闭 qwen3 系列思考模式，避免 reasoning_content 导致延迟过高
            // 注意：DashScope 接受直接在请求 body 中传递 enable_thinking 参数
            // Node.js SDK 没有 Python 的 extra_body，直接放在 params 中即可
            const stream = await this.slcClient.chat.completions.create({
                model: slcModel,
                messages: messages as any,
                stream: true,
                max_tokens: undefined, // 不硬限制，由 TTS_FRIENDLY_PROTOCOL 提示词控制长度
                temperature: 0.8,
                tools: tools.length > 0 ? tools as any : undefined,
                tool_choice: tools.length > 0 ? 'auto' : undefined,
                enable_thinking: false  // 关闭思考模式
            } as any, { signal: controller.signal }) as any;

            clearTimeout(timeoutId);

            let isFirstToken = true;
            // [V4.1] 累积 tool_calls 参数（流式增量）
            let toolCallAccumulator: { index: number; id?: string; name?: string; arguments?: string } | null = null;
            let streamUsage: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | undefined;

            for await (const chunk of stream as any) {
                if (signal.interrupted || signal.slcDone) break;
                const content = chunk.choices[0]?.delta?.content;
                if (content) {
                    // [V3.7.2] 耗时追踪: 首字与首句耗时
                    if (isFirstToken) {
                        if (tracker) tracker.recordTTFT();
                        isFirstToken = false;
                    }
                    // 检测常见句子分隔符
                    if (content.includes('，') || content.includes('。') || content.includes('！') || content.includes('？') || content.includes(',') || content.includes('.') || content.includes('!')) {
                        if (tracker) tracker.recordFirstSentence();
                    }

                    slcFullText += content;

                    // [V4.5] 硬拦截：剥离 <shadow> 和 </shadow> 标签本身（保留内容，防止误删模型回复）
                    let filteredContent = content
                        .replace(/<shadow>/g, '')
                        .replace(/<\/shadow>/g, '');

                    // [ARCH] 剥离 FUNC 标签（func_tags 模式下，用户不应看到标签内容）
                    if (funcMode) {
                        filteredContent = filteredContent.replace(/\[FUNC:[^\]]*\]/g, '');
                    }

                    // [V4.5] 硬拦截：end_session 阶段剥离所有 ACTION
                    const effectiveMode = state.metadata.current_mode || this.modeManager?.getInitialMode() || 'unknown';
                    if (effectiveMode === 'end_session') {
                        filteredContent = filteredContent.replace(/\[ACTION:[^\]]+\]/g, '');
                    }

                    // [V4.5] 硬拦截：剥离文本态 mode_switch ACTION
                    filteredContent = filteredContent.replace(/\[ACTION:mode_switch\]/g, '');
                    filteredContent = filteredContent.replace(/\[mode_switch\]/g, '');

                    if (!filteredContent.trim()) continue;

                    let type: any = 'chat';
                    if (isInternal) type = 'internal';
                    else if (isIdle) type = 'idle';
                    else if (isWaiting) type = 'waiting';
                    else if (isPolish) type = 'chat';

                    // [V4.1] 传递当前 mode 信息给前端
                    const currentMode = state.metadata.current_mode || this.modeManager?.getInitialMode() || 'unknown';
                    const modeDescription = this.modeManager?.getModeDescriptions().split('\n')
                        .find(line => line.startsWith(`- ${currentMode}:`))
                        ?.replace(`- ${currentMode}: `, '') || '';
                    onChunk({ content: filteredContent, isFinal: false, type, mode: currentMode, modeDescription });
                }

                // [V4.1] 检测 tool_calls（流式增量，需累积）
                if (chunk.choices[0]?.delta?.tool_calls) {
                    const tcDelta = chunk.choices[0].delta.tool_calls[0];
                    if (tcDelta) {
                        if (!toolCallAccumulator) {
                            toolCallAccumulator = { index: tcDelta.index || 0 };
                        }
                        if (tcDelta.id) toolCallAccumulator.id = tcDelta.id;
                        if (tcDelta.function?.name) toolCallAccumulator.name = tcDelta.function.name;
                        if (tcDelta.function?.arguments) {
                            toolCallAccumulator.arguments = (toolCallAccumulator.arguments || '') + tcDelta.function.arguments;
                        }
                    }
                }

                // 收集流式 usage（最后一个 chunk 包含）
                if (chunk.usage) {
                    streamUsage = {
                        prompt_tokens: chunk.usage.prompt_tokens,
                        completion_tokens: chunk.usage.completion_tokens,
                        total_tokens: chunk.usage.total_tokens,
                    };
                }
            }

	                        // [V3.7.2] 耗时追踪: SLC 主流结束（不含 follow-up）
            if (tracker) tracker.record('SLC_END');

            // [ARCH] FUNC 标签解析器（func_tags 模式下生效，在文本 fallback 之前）
            // 支持 3 种语法: func_call [FUNC:name(args)], colon [FUNC:name:args], pipe [FUNC:name|args]
            if (funcMode && !toolCallAccumulator) {
                const funcSyntax = process.env.VOICE_GATEWAY_ARCH_FUNC_SYNTAX || 'func_call';
                let funcMatch: RegExpMatchArray | null = null;
                let funcName = '', funcArgs = '';

                if (funcSyntax === 'func_call') {
                    funcMatch = slcFullText.match(/\[FUNC:(\w+)\(([^)]*)\)\]/);
                } else if (funcSyntax === 'colon') {
                    funcMatch = slcFullText.match(/\[FUNC:(\w+):([^\]]+)\]/);
                } else { // pipe
                    funcMatch = slcFullText.match(/\[FUNC:(\w+)\|([^\]]+)\]/);
                }

                if (funcMatch && funcMatch[1]) {
                    [, funcName, funcArgs] = funcMatch;
                    console.log(`[SLCEngine][${callId}] FUNC标签检测: ${funcName}(${funcArgs}), syntax=${funcSyntax}`);
                    if (funcName === 'mode_switch') {
                        const targetMatch = funcArgs.match(/target_mode[=\s:]+(\w+)/);
                        const targetMode = targetMatch?.[1];
                        // 禁止冗余切换：目标模式与当前模式相同时忽略
                        const currentMode = state.metadata.current_mode || this.modeManager?.getInitialMode() || '';
                        if (targetMode && targetMode !== currentMode && this.modeManager?.hasMode(targetMode)) {
                            toolCallAccumulator = {
                                index: 0, id: 'func_tag_mode_switch', name: 'mode_switch',
                                arguments: JSON.stringify({ target_mode: targetMode, context: { source: 'func_tag' } })
                            };
                        } else if (targetMode === currentMode) {
                            console.log(`[SLCEngine][${callId}] FUNC标签忽略：冗余切换到当前模式 ${targetMode}`);
                        }
                    } else if (funcName === 'trigger_sle_check' && onToolCall) {
                        const reasonMatch = funcArgs.match(/reason[=\s:]+"?([^"]+)"?/);
                        onToolCall('trigger_sle_check', { reason: reasonMatch?.[1] || 'slc_detected' });
                    }
                    slcFullText = slcFullText.replace(funcMatch[0], '').trim();
                }

                // 清理残留的空 FUNC 标签（如 [FUNC: ] 或 [FUNC:]）
                slcFullText = slcFullText.replace(/\[FUNC:\s*\]/g, '').trim();
            }

            // [V4.3 兜底] 文本态虚拟工具调用检测
            // 当模型不输出 tool_calls delta 而是直接以文本形式输出时（如 qwen3.6-flash）
            if (!toolCallAccumulator && onToolCall) {
                const sleCheckMatch = slcFullText.match(/trigger_sle_check\s*\(\s*(?:reason\s*=\s*)?['"]([^'"]+)['"]\s*\)/);
                if (sleCheckMatch) {
                    console.log(`[SLCEngine][${callId}] 兜底检测：文本态 trigger_sle_check(reason="${sleCheckMatch[1]}")`);
                    onToolCall('trigger_sle_check', { reason: sleCheckMatch[1] });
                    slcFullText = slcFullText.replace(/trigger_sle_check\s*\([^)]*\)/, '').trim();
                }
            }


            
            // [V4.5 兜底] 文本态 mode_switch 检测
            // 当模型输出 [ACTION:mode_switch] 或 mode_switch(target_mode="xxx") 文本而非 tool_call 时
            if (!toolCallAccumulator && this.modeManager) {
                const actionModeSwitchMatch = slcFullText.match(/\[ACTION:mode_switch\]|\[mode_switch\]/);
                const funcModeSwitchMatch = slcFullText.match(/mode_switch\s*\(\s*(?:target_mode\s*=\s*)?['"](\w+)['"]\s*/);

                let textModeTarget: string | null = null;
                if (funcModeSwitchMatch) {
                    textModeTarget = funcModeSwitchMatch[1];
                } else if (actionModeSwitchMatch) {
                    const afterSwitch = slcFullText.split(actionModeSwitchMatch[0]).pop() || '';
                    const modeHints: [string, RegExp][] = [
                        ['discovery', /需求|探寻|业务|场景|做(什么|哪)/],
                        ['solution', /方案|推荐|产品|RTC|语音|直播|IM|AI/],
                        ['integration_guide', /接入|文档|SDK|平台|鉴权|计费|价格/],
                        ['conversion', /试用|测试|留资|联系|申请/],
                        ['end_session', /再见|结束|拜|告辞/],
                    ];
                    for (const [mode, regex] of modeHints) {
                        if (regex.test(afterSwitch)) { textModeTarget = mode; break; }
                    }
                }

                if (textModeTarget && this.modeManager.hasMode(textModeTarget)) {
                    console.log(`[SLCEngine][${callId}] 兜底检测：文本态 mode_switch → ${textModeTarget}`);
                    toolCallAccumulator = {
                        index: 0,
                        id: 'text_mode_switch',
                        name: 'mode_switch',
                        arguments: JSON.stringify({ target_mode: textModeTarget, context: { source: 'text_fallback' } })
                    };
                    slcFullText = slcFullText
                        .replace(/\[ACTION:mode_switch\]/g, '')
                        .replace(/\[mode_switch\]/g, '')
                        .replace(/mode_switch\s*\([^)]*\)/g, '')
                        .trim();
                }
            }

            // [V4.1] 处理 mode_switch 工具调用
            if (toolCallAccumulator && toolCallAccumulator.name === 'mode_switch') {
                try {
                    const args = JSON.parse(toolCallAccumulator.arguments || '{}');
                    if (args.target_mode && this.modeManager) {
                        console.log(`[SLCEngine][${callId}] 模式切换: ${args.target_mode}`);

                        // [V4.4] 若 SLC 只输出了 mode_switch 但无文本，补发过渡语确保用户有感知
                        if (!slcFullText.trim()) {
                            const fallbackTransition = '好的，我来看看~';
                            onChunk({ content: fallbackTransition, isFinal: false, type: 'chat', mode: args.target_mode });
                            slcFullText = fallbackTransition;
                        }

                        // 更新 ShadowState
                        await shadowManager.updateState({
                            metadata: {
                                current_mode: args.target_mode,
                                mode_pending_injection: args.target_mode,
                                switch_context: args.context || null
                            }
                        }, callId);

                        // [V4.4] 立即注入新 mode 提示词并再跑一轮 SLC，让 LLM 按新 mode 回答
                        const newModePrompt = this.modeManager!.getModePrompt(args.target_mode);
                        if (newModePrompt) {
                            const followUpMessages = [...messages, { role: 'user', content: `[模式引导]\n${newModePrompt}` }];
                            // 用历史最后一条 user 消息作为输入，让新 mode 回答
                            const lastUserMsg = dialogueMessages.filter((m: any) => m.role === 'user').pop();
                            if (lastUserMsg) {
                                followUpMessages.push({ role: 'user', content: lastUserMsg.content });
                            }

                            try {
                                const followUpStream = await this.slcClient.chat.completions.create({
                                    model: slcModel,
                                    messages: followUpMessages as any,
                                    stream: true,
                                    max_tokens: 300,
                                    temperature: 0.8,
                                    enable_thinking: false
                                } as any);

                                let followUpText = '';
                                for await (const chunk of followUpStream as any) {
                                    if (signal.interrupted || signal.slcDone) break;
                                    const content = chunk.choices[0]?.delta?.content;
                                    if (content) {
                                        followUpText += content;
                                        // [V4.5] follow-up SLC 同样剥离 shadow 标签
                                        let filteredContent = content
                                            .replace(/<shadow>/g, '')
                                            .replace(/<\/shadow>/g, '');
                                        if (args.target_mode === 'end_session') {
                                            filteredContent = filteredContent.replace(/\[ACTION:[^\]]+\]/g, '');
                                        }
                                        filteredContent = filteredContent.replace(/\[ACTION:mode_switch\]/g, '').replace(/\[mode_switch\]/g, '');
                                        if (filteredContent.trim()) {
                                            onChunk({ content: filteredContent, isFinal: false, type: 'chat', mode: args.target_mode });
                                        }
                                    }
                                }
                                slcFullText += followUpText;
                            } catch (e) {
                                console.warn(`[SLCEngine][${callId}] mode_switch follow-up SLC 失败: ${e}`);
                            }

                            // 标记已注入，避免下一轮重复注入
                            state.metadata.mode_pending_injection = null;
                            state.metadata.mode_injected = args.target_mode;
                        }

                        // [V4.2] 通知前端模式已切换（发送一个特殊的 mode_update 事件）
                        onChunk({
                            content: '',
                            isFinal: true,
                            type: 'mode_update',
                            mode: args.target_mode,
                            modeDescription: this.modeManager!.getModeDescriptions().split('\n')
                                .find(line => line.startsWith(`- ${args.target_mode}:`))
                                ?.replace(`- ${args.target_mode}: `, '') || args.target_mode
                        });
                    }
                } catch (e) {
                    console.warn(`[SLCEngine] mode_switch 解析失败: ${e}`);
                }
            }

            // [V4.3] 处理 trigger_sle_check 工具调用
            if (toolCallAccumulator && toolCallAccumulator.name === 'trigger_sle_check') {
                try {
                    const args = JSON.parse(toolCallAccumulator.arguments || '{}');
                    console.log(`[SLCEngine][${callId}] 触发 SLE 意图校验: ${args.reason}`);
                    if (onToolCall) onToolCall('trigger_sle_check', args);
                } catch (e) {
                    console.warn(`[SLCEngine] trigger_sle_check 解析失败: ${e}`);
                }
            }



            // [V4.1] 记录 tool_calls 日志（用于审计模式切换等虚拟工具调用）
            if (toolCallAccumulator) {
                LlmLogger.log(
                    { source, scenario: 'SLC_TOOL_CALL', callId, model: slcModel },
                    messages,
                    JSON.stringify({
                        tool_name: toolCallAccumulator.name,
                        arguments: toolCallAccumulator.arguments
                    })
                );
            }

            LlmLogger.log({ source, scenario: 'SLC_CHAT', callId, model: slcModel }, messages, slcFullText, streamUsage);
        } catch (e: any) {
            console.warn(`[SLCEngine Error] ${e}`);
            // [V3.6.13] 即便失败也要记录审计日志，确保身份追踪链路完整
            const slcModel = this.config.fastAgent?.slcModel!;
            const callId = getCurrentCallId() || 'global';
            const isIdle = text === '__IDLE_TRIGGER__';
            const isInternal = text === '__INTERNAL_TRIGGER__';
            let source = 'User-Input';
            if (isInternal) source = 'Async-Result-Delivery';
            else if (isIdle) source = 'Watchdog-Idle';
            
            LlmLogger.log({ source, scenario: 'SLC_CHAT', callId, model: slcModel }, (e as any).messages || [], `[ERROR] ${e.message}`);

            // [V3.6.2] FALLBACK-01: 兜底播报
            if (e.name === 'AbortError' || e.message?.includes('timeout')) {
                const fallback = this.config.advanced?.fallbackMessage || "让我想想...";
                onChunk({ content: fallback, isFinal: false, type: 'chat' });
                slcFullText += fallback;
            }
        }
        return slcFullText;
    }

    /**
     * 温字连接
     */
    async warmUp() {
        try {
            await this.slcClient.chat.completions.create({
                model: this.config.fastAgent?.slcModel!,
                messages: [{ role: 'user', content: '.' }],
                max_tokens: 1
            });
            console.log('[SLCEngine] 💓 Warm-up finished.');
        } catch (e) { }
    }
}
