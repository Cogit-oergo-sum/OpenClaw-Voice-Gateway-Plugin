import OpenAI from 'openai';
import { ShadowManager } from './shadow-manager';
import { PluginConfig } from '../types/config';
import { getCurrentCallId } from '../context/ctx';

export interface FastAgentResponse {
    content: string;
    isFinal: boolean;
    type: 'text' | 'filler' | 'tool_result' | 'thought' | 'bridge';
}

/**
 * FastAgent 核心类：实现并联抢跑接力架构 (Parallel Relay) V1.6.0
 * 升级：语义缝合、思考哨兵、音流占位
 */
export class FastAgent {
    private openai: OpenAI;
    private slcClient: OpenAI;
    private shadow: ShadowManager;

    constructor(private config: PluginConfig, workspaceRoot: string) {
        this.openai = new OpenAI({
            apiKey: config.llm.apiKey,
            baseURL: config.llm.baseUrl
        });
        this.slcClient = this.openai;
        this.shadow = new ShadowManager(workspaceRoot);
    }

    async process(
        text: string, 
        onChunk: (resp: FastAgentResponse) => void
    ) {
        const callId = getCurrentCallId() || 'anonymous';
        // 1. 物理层预通：立即发起 Session 启动日志，验证 WAL 链路
        await this.shadow.updateState({ mode: 'session_start', metadata: { text_input: text } });
        
        // 自动尝试从 WAL 恢复状态 (只有在内存丢失时才会执行)
        await this.shadow.recover(callId);
        
        const soulPrompt = await this.shadow.getContextPrompts();
        
        const baseHistory = [
            { role: 'system', content: soulPrompt },
            { role: 'user', content: text }
        ];

        console.log(`[ParallelRelay][${callId}] Starting Race...`);

        let cachedFiller = "";
        let deliveredText = ""; // 【新】物理层真正送达的文本
        let isSLEActive = false; // 【新】SLE 互斥标志
        let isToolCallDetected = false;
        let slcFinished = false;
        let sleFinished = false;
        let isInterrupted = false; // 【新】物理打断标志

        // --- 1. 路 A: SLC 抢跑流 ---
        const slcPromise = (async () => {
            try {
                const stream = await this.slcClient.chat.completions.create({
                    model: this.config.llm.model,
                    messages: [
                        ...baseHistory,
                        { 
                            role: 'system', 
                            content: '[Technical Hint]: 请以 Jarvis 身份立刻给出第一句感官响应（确认收到或简单应答），严格限制在 30 字以内。' 
                        }
                    ] as any,
                    stream: true,
                    max_tokens: 50
                });

                for await (const chunk of stream) {
                    const content = chunk.choices[0]?.delta?.content;
                    if (content) {
                        cachedFiller += content;
                        // 如果 SLE 还没产出结果且未被打断，就输出并更新已送达缓冲
                        if (!isToolCallDetected && !isInterrupted) {
                            onChunk({ content, isFinal: false, type: 'filler' });
                            deliveredText += content;
                        }
                    }
                }
            } finally {
                slcFinished = true;
                console.log(`[SLC][${callId}] Finished: "${cachedFiller}"`);
            }
        })();

        // --- 2. 思考哨兵 (Thinking Watchdog) ---
        const watchdog = setTimeout(() => {
            if (slcFinished && !sleFinished && !isToolCallDetected) {
                console.log(`[Watchdog][${callId}] Secondary silence detected, injecting acoustic filler...`);
                // 发送占位音流信号 (Acoustic Bridge)
                onChunk({ content: " ... ", type: 'bridge', isFinal: false });
            }
        }, 1200);

        // --- 3. 路 B: SLE 逻辑流 ---
        const slePromise = (async () => {
            try {
                const stream = await this.openai.chat.completions.create({
                    model: this.config.llm.model,
                    messages: baseHistory as any,
                    stream: true,
                    tools: [
                        {
                            type: 'function',
                            function: {
                                name: 'delegate_openclaw',
                                description: '委派复杂任务给主控助理。',
                                parameters: {
                                    type: 'object',
                                    properties: {
                                        intent: { type: 'string' }
                                    }
                                }
                            }
                        }
                    ]
                });

                let toolName = '';
                let toolArgs = '';

                for await (const chunk of stream) {
                    const delta = chunk.choices[0]?.delta;
                    if (delta?.tool_calls) {
                        isToolCallDetected = true;
                        const tc = delta.tool_calls[0];
                        if (tc.function?.name) toolName += tc.function.name;
                        if (tc.function?.arguments) toolArgs += tc.function.arguments;
                    }
                }

                if (isToolCallDetected) {
                    isSLEActive = true; // 激活互斥锁，抢占总线
                    clearTimeout(watchdog);
                    onChunk({ content: `[系统: 执行 ${toolName}]`, isFinal: false, type: 'thought' });
                    
                    // 设置音流缝合桥接 (Breath Bridge)
                    onChunk({ content: " ", type: 'bridge', isFinal: false });

                    let toolResult = "";
                    if (toolName === 'delegate_openclaw') {
                        await new Promise(r => setTimeout(r, 800));
                        toolResult = `[系统反馈]: 任务已委派给主控处理。`;
                        await this.shadow.updateState({ mode: 'task_delegated', task_id: 'auto_generated' });
                    }
                    
                    // --- 语义缝合：基于 deliveredText 决定补白策略 ---
                    const relayMessages = [
                        ...baseHistory,
                        { 
                            role: 'assistant', 
                            content: deliveredText, // 仅填充真正送达的部分
                            tool_calls: [{ id: 'call_relay', type: 'function', function: { name: toolName, arguments: toolArgs } }] 
                        },
                        { role: 'tool', tool_call_id: 'call_relay', name: toolName, content: toolResult },
                        {
                            role: 'system',
                            content: `[语义缝合指令]: 
1. 用户已经听到了你刚才说的：“${deliveredText}”。
2. 如果上一句没说完，请从被打断的地方自然补齐并转折。
3. 请确保语气连贯，直接切入重点。`
                        }
                    ];

                    const stream2 = await this.openai.chat.completions.create({
                        model: this.config.llm.model,
                        messages: relayMessages as any,
                        stream: true
                    });

                    for await (const chunk of stream2) {
                        const content = chunk.choices[0]?.delta?.content;
                        if (content) {
                            onChunk({ content, isFinal: false, type: 'text' });
                        }
                    }
                }
            } finally {
                sleFinished = true;
                clearTimeout(watchdog);
            }
        })();

        await Promise.all([slcPromise, slePromise]);
        onChunk({ content: '', isFinal: true, type: 'text' });
    }
}
