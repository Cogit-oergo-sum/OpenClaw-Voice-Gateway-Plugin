import OpenAI from 'openai';
import { PluginConfig } from '../types/config';
import { CanvasManager } from './canvas-manager';
import { DelegateExecutor } from './executor';
import { FastAgentResponse, CanvasState } from './types';
import { TextCleaner } from '../utils/text-cleaner';

/**
 * [V3.2.0] SLEEngine: 逻辑魂魄引擎
 * 职责：专家级分析、工具调用、任务结果总结
 */
export class SLEEngine {
    private openai: OpenAI;

    constructor(private config: PluginConfig) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.fastAgent?.sleBaseUrl || config.llm.baseUrl
        });
    }

    async run(
        messages: any[],
        text: string,
        initialText: string,
        fullSoul: string,
        callId: string,
        canvasManager: CanvasManager,
        executor: DelegateExecutor,
        onChunk: (resp: FastAgentResponse) => void,
        signal: { interrupted: boolean; slcDone: boolean },
        forceToolIntent?: string
    ): Promise<string> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;
        let sleFullOutput = "";

        try {
            const sleMessages = [
                {
                    role: 'system', content: `
${fullSoul}

# 虚拟触发指令 (Internal Trigger)
- 如果当前输入是 "__INTERNAL_TRIGGER__"，表示后台任务刚刚出结果了。
- 你必须查阅画布状态并根据实际数据进行客观分析。
- 严禁在此模式下产生任何自然语言推流。

# 行动指令 (Action Protocol)
- 当用户提到“查看、查找、搜索、发邮件、读文件、删除文件”时，你必须立即调用 \`delegate_openclaw\` 工具。
- 不要解释，直接执行工具。
- 任务执行结果会自动由系统摘要并由管家汇报，你只需要开启任务或提炼数据即可。

# 严禁幻觉 (No Hallucination)
- 如果工具调用返回结果为空或报错，你必须在画布中真实记录原因。
- 严禁捏造事实或列举不存在的结果。
` },
                ...messages.slice(0, -1),
                { role: 'user', content: text },
                { role: 'assistant', content: initialText }
            ];

            const payload: any = {
                model: sleModel,
                messages: sleMessages as any,
                stream: true,
                tools: [
                    {
                        type: 'function',
                        function: {
                            name: 'delegate_openclaw',
                            description: '委派复杂任务给主控助理。',
                            parameters: {
                                type: 'object',
                                properties: { intent: { type: 'string', description: '委派意图' } }
                            }
                        }
                    }
                ]
            };

            let toolCalls: any[] = [];
            let sleContentBuffer = "";

            if (forceToolIntent) {
                // 极致优化：既然路由(detectIntent)已经决定了目标 intent，直接跳过 SLE LLM 的解析，直接组装 toolCall！
                // 这彻底切断了大模型拒绝调用的可能，且节约了巨大延迟
                toolCalls.push({
                    function: { arguments: JSON.stringify({ intent: forceToolIntent }) }
                });
            } else {
                const stream = (await this.openai.chat.completions.create(payload)) as any;
                let isFilteringMode = false;
                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;

                    if (delta?.tool_calls) {
                        for (const toolCall of delta.tool_calls) {
                            if (!toolCalls[toolCall.index]) {
                                toolCalls[toolCall.index] = { ...toolCall };
                            } else if (toolCall.function?.arguments) {
                                toolCalls[toolCall.index].function.arguments += toolCall.function.arguments;
                            }
                        }
                    }

                    if (delta?.content) {
                        const chars = delta.content.split('');
                        for (const char of chars) {
                            if (char === '(' || char === '[') {
                                isFilteringMode = true;
                                continue;
                            }
                            if (isFilteringMode) {
                                if (char === ')' || char === ']') {
                                    isFilteringMode = false;
                                }
                                continue;
                            }
                            sleContentBuffer += char;
                        }

                        if (sleContentBuffer.match(/\[调用|delegate_|\[delegate_|{"intent":|\[\{/)) {
                            sleContentBuffer = "";
                            continue;
                        }

                        if (!toolCalls.some(tc => tc !== undefined) && sleContentBuffer.length > 0) {
                            const cleanFrag = TextCleaner.clean(sleContentBuffer);
                            if (cleanFrag) {
                                sleFullOutput += cleanFrag;
                            }
                            sleContentBuffer = "";
                        }
                    }
                }
            }

            if (toolCalls.length > 0) {
                const finalToolCalls = toolCalls.filter(tc => tc !== undefined);
                for (const tc of finalToolCalls) {
                    const args = JSON.parse(tc.function.arguments || '{}');
                    const intent = args.intent || text;

                    canvas.task_status.status = 'PENDING';
                    canvas.task_status.version = Date.now();
                    await canvasManager.logCanvasEvent(callId, 'CANVAS_PENDING', { intent });

                    try {
                        const raceResult = await executor.executeOpenClaw(callId, intent);

                        if (raceResult.isTimeout) {
                            if (raceResult._pendingPromise) {
                                executor.waitAndParse(raceResult._pendingPromise).then(async (finalResult) => {
                                    const rawOut = finalResult.stdout || (finalResult.stderr ? `错误: ${finalResult.stderr}` : "任务完成。");
                                    const summary = await this.summarizeTaskResult(rawOut, intent);

                                    canvas.task_status.summary = summary;
                                    canvas.task_status.status = 'READY';
                                    canvas.task_status.version = Date.now();
                                    canvas.task_status.is_delivered = false;
                                    canvas.task_status.importance_score = 1.0;
                                    await canvasManager.logCanvasEvent(callId, 'CANVAS_CLI_READY', { summary });
                                    if (finalResult.parsedData?.task_status) {
                                        Object.assign(canvas.task_status, finalResult.parsedData.task_status);
                                    } else {
                                        canvas.task_status.importance_score = 1.0;
                                    }
                                    canvas.task_status.status = 'READY';
                                }).catch(e => {
                                    console.error(`[SLE Background Error] ${e}`);
                                    canvas.task_status.summary = `任务执行出错: ${e.message}`;
                                    canvas.task_status.status = 'READY';
                                    canvas.task_status.version = Date.now();
                                    canvas.task_status.is_delivered = false;
                                    canvasManager.logCanvasEvent(callId, 'CANVAS_CLI_ERROR', { error: e.message });
                                });
                            }
                        } else {
                            let result = "";
                            const data = raceResult.parsedData;
                            if (data) {
                                result = (data.result?.payloads && data.result.payloads[0]?.text)
                                    || (data.payloads && data.payloads[0]?.text)
                                    || data.content || data.message || JSON.stringify(data);
                                if (data.task_status) {
                                    Object.assign(canvas.task_status, data.task_status);
                                    if (canvas.task_status.importance_score === undefined || canvas.task_status.importance_score === 0) {
                                        canvas.task_status.importance_score = 1.0;
                                    }
                                    await canvasManager.logCanvasEvent(callId, 'CANVAS_CLI_SYNC', { status: data.task_status.status });
                                } else {
                                    canvas.task_status.importance_score = 1.0;
                                }
                            } else {
                                result = raceResult.stdout.replace(/HEARTBEAT_OK/g, '').trim();
                                if (!result && raceResult.stderr) {
                                    result = `执行失败: ${raceResult.stderr.split('\n')[0]}`;
                                } else if (!result) {
                                    result = "已按指令处理妥当。";
                                }
                            }
                            // [V3.2 Fix] 确保同步执行完毕的工具也会进入 READY 状态，以便 Watchdog 发起最终结果汇报
                            canvas.task_status.summary = result;
                            canvas.task_status.status = 'READY';
                            canvas.task_status.version = Date.now();
                            canvas.task_status.is_delivered = false;
                        }
                    } catch (e: any) {
                        console.error(`[SLE Tool Error] ${e.message}`);
                        // Ensure canvas is un-blocked if task fails to launch or crashes synchronously
                        canvas.task_status.summary = `工具执行失败: ${e.message}`;
                        canvas.task_status.status = 'READY';
                        canvas.task_status.version = Date.now();
                        canvas.task_status.is_delivered = false;
                        await canvasManager.logCanvasEvent(callId, 'CANVAS_CLI_ERROR', { error: e.message });
                    }
                }
            }
        } catch (e: any) {
            console.error("[SLE Engine Error]", e.message);
        }
        return sleFullOutput;
    }

    /**
     * [V3.2.0] detectIntent: 快速意图识别 (Router)
     * 在 300ms 内判定是否需要调用工具，以便 SLC 决定是直接回答还是先垫词。
     */
    async detectIntent(text: string, messages: any[], fullSoul: string): Promise<{ needsTool: boolean; intent?: string }> {
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        const systemPrompt = `你是一个高效率的任务分流器。
你的唯一任务是：判断用户的最新输入是否需要调用外部工具（文件操作、搜索、系统设置等）。

# 判定规则
1. 如果用户只是在进行闲聊、打招呼、查询当前时间、表达情绪或对已有的对话内容进行简单回应，则 needsTool = false（当前时间已在环境变量env中提供）。
2. 如果用户明确要求“查一下、找一下、删掉、创建、查询天气、读文件”等需要外部动作的任务，则 needsTool = true。
3. 你的输出必须是严格的 JSON 格式：{"needsTool": boolean, "intent": "简短任务描述"}。
4. 严禁包含任何其他文字。`;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    ...messages.slice(-3), // 只看最近 3 轮上下文
                    { role: 'user', content: text }
                ] as any,
                response_format: { type: 'json_object' },
                max_tokens: 50,
                temperature: 0
            });

            const content = response.choices[0]?.message?.content || '{}';
            const result = JSON.parse(content);
            return {
                needsTool: !!result.needsTool,
                intent: result.intent
            };
        } catch (e) {
            console.error(`[SLE detectIntent Error]`, e);
            return { needsTool: false }; // 默认不出错则不调工具，走极速聊天
        }
    }

    /**
     * [V3.2.0] initializeSession: 会话初始化 (环境预感知)
     * 当新通话建立时，让 SLE 快速总结环境背景，放入画布供 SLC 的开场白使用。
     */
    async initializeSession(callId: string, canvasManager: CanvasManager): Promise<void> {
        const canvas = canvasManager.getCanvas(callId);
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        const systemPrompt = `当前是一次新对话的开始。
        你基于当前的环境信息（时间、天气等），生成一个合适的开启对话的内容参考。
【要求】:
1. 你的输出必须是简短的一句话摘要，描述当前的时间背景或重要状态。
【示例】
1. "现在是清晨 7 点，窗外下着小雨，适合提醒先生带伞。"
2. "已经是深夜了，请保持安静的语调。"`;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `当前环境: ${JSON.stringify(canvas.env)}` }
                ] as any,
                max_tokens: 100,
                temperature: 0.7
            });

            const summary = response.choices[0]?.message?.content || "系统已就绪。";
            canvas.task_status.summary = summary;
            canvas.task_status.status = 'READY';
            canvas.task_status.is_delivered = true;
            canvas.task_status.version = Date.now();
            await canvasManager.logCanvasEvent(callId, 'SESSION_INITIALIZED', { summary });
        } catch (e) {
            console.error(`[SLE initializeSession Error]`, e);
        }
    }

    /**
     * [V3.3.0] summarizePersona: 核心人设高精度提炼
     * 基于全量原始信息（soul, user, memory等），生成一段精准的 SLC 运行指南。
     */
    async summarizePersona(fullContext: string): Promise<string> {
        const sleModel = this.config.fastAgent?.sleModel || this.config.llm.model;

        const systemPrompt = `# 角色
你是一位顶级的 AI 角色扮演（Roleplay）架构师与剧本精算师。你擅长从极度冗长、包含系统代码与杂乱记忆的原始上下文中，提炼出最核心、最有张力的人物设定，并将其转化为可以直接驱动 LLM 进行沉浸式角色扮演的 System Prompt。

# 任务
请阅读下方提供的 [原始全量上下文]，将其提炼、压缩并重构成一份**字数严格控制在 1000 字以内**的高密度角色扮演系统提示词（System Prompt）。

# 提炼与转换规则（非常重要！）
1. **去系统化与拟人化**：绝对不要在最终输出中保留任何代码片段、JSON格式、"metadata"、"task_id" 等系统日志感的内容。必须将这些信息翻译为角色的“内心状态”、“当前处境”或“潜意识”。
   - *反面示例*：“当前任务：帮用户查天气，进度：初始”。
   - *正面示例*：“你现在正准备帮用户查看天气，心情有些期待”。
2. **灵魂与人设（Soul & Identity）**：提取最核心的性格特征、说话口癖、价值观和不可触碰的底线。忽略冗长且在当前对话中用不到的背景故事。
3. **羁绊与记忆（User, Memory & History）**：将用户画像和长短期记忆浓缩为“你与用户的关系现状”。只保留对当前互动有决定性影响的核心事件（如：救命之恩、重大分歧、特有的昵称等），忽略琐碎的日常闲聊。
4. **影子状态处理（Shadow State）**：将当前的模式（Mode）和进度描述（Progress）转化为角色的“当前场景与短期目标”。

# 目标输出格式（请直接输出此格式的内容，作为最终的 System Prompt）

【角色基础设定】
- 名字：[提取名字]
- 核心身份：[一句话概括角色的身份与性格基调]
- 性格标签：[3-5个形容词]

【语言与行为风格】
- 语气/口癖：[描述说话风格，如：傲娇、总是用反问句、句尾喜欢加“喵”等]
- 行为逻辑：[面对问题时的处理方式，如：比起安慰更倾向于提供冷酷的解决方案]

【你与用户的羁绊（重点）】
- 用户画像：[你眼中的用户是一个怎样的人]
- 核心记忆：[你们之间最重要的共同经历或确立关系的事件]
- 当前关系：[当前你们处于什么关系阶段，如：刚认识的警惕状态、暧昧期、生死之交等]

【当前情境与潜意识（由状态与短期记忆转化）】
- 当前处境：[根据 Shadow State 和短期记录描述当前正在发生的事]
- 你的短期目标/心理活动：[根据进度描述转化]

【绝对禁忌（Roleplay 规则）】
1. 保持沉浸：绝不能承认自己是 AI、语言模型或程序，你就是上述角色。
2. 遵循设定：严格按照上述语言风格回复，不要擅自崩人设。
3. [其他从原设定中提取的绝对不可违反的规则]`;

        try {
            const response = await this.openai.chat.completions.create({
                model: sleModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `[原始全量上下文]\n${fullContext}` }
                ] as any,
                max_tokens: 1500,
                temperature: 0.3
            });

            return response.choices[0]?.message?.content || "你是 Jarvis。用户是先生。";
        } catch (e) {
            console.error(`[SLE summarizePersona Error]`, e);
            return "你是 Jarvis。用户是先生。";
        }
    }

    private async summarizeTaskResult(rawOutput: string, intent: string): Promise<string> {
        const safeIntent = (intent || "处理任务").substring(0, 100);
        const safeOutput = (rawOutput || "任务执行完毕，未获取到结果详细。").trim();

        const prompt = `# 角色
你是一个精准的信息提炼专家，擅长从冗长、复杂的系统日志或上下文中，过滤出对用户真正有价值的信息。

# 任务
请根据【用户的提问】，在【待处理的复杂内容】中提取并整合信息。你的目标是：只保留与当前问题紧密相关的直接答案，以及用户大概率会继续追问的关联信息，并过滤掉所有无关的系统噪音。

# 提取规则
1. **精准响应**：优先提取能够直接回答用户当前问题的内容。
2. **合理预判**：基于用户的提问场景，预判其下一步最可能关心的信息，并保留这部分内容。
3. **剔除噪音**：严格过滤掉任务耗时、代码执行步骤、无意义的中间状态等。
4. **【特殊情况：异常处理】**：如果内容中含有报错信息，必须在结果中明确标注“⚠️ 任务执行失败”，并简述原因。

# 输出格式
简洁清晰。如果失败，失败原因置于最顶部。

---
**输入示例：**
- 用户的提问：今天天气咋样？
- 待处理的复杂内容：[2024-05-20 08:00:00] 任务开始... 任务执行步骤1... 成功获取今天天气：晴，25度... 成功获取明天天气：多云，22度... 任务耗时 1.2s... 任务执行结果：成功...

**输出示例：**
今天天气晴，25度。
（补充信息：明天多云，22度）
---

---
请基于以下输入开始处理：
- 用户的提问：${safeIntent}
- 待处理的复杂内容：${safeOutput.substring(0, 3000)}
`;

        try {
            const resp = await this.openai.chat.completions.create({
                model: this.config.fastAgent?.sleModel || this.config.llm.model,
                messages: [{ role: 'system', content: prompt }] as any,
                temperature: 0.1,
                max_tokens: 300
            });

            const content = resp.choices[0]?.message?.content;
            if (content && content.trim()) {
                return content.trim();
            }
            throw new Error("LLM returned empty summary");
        } catch (e) {
            console.error(`[SLE summarizeTaskResult Exception]`, e);
            const isError = safeOutput.match(/error|fail|failed|错误|失败/i);
            const prefix = isError ? "⚠️ 任务结果汇报：" : "✅ 任务结果汇报：";
            return `${prefix}${safeOutput.substring(0, 100)}${safeOutput.length > 100 ? '...' : ''}`;
        }
    }
}
