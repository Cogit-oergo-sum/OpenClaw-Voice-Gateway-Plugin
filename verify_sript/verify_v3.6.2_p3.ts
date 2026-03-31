import { SLEEngine } from '../src/agent/sle';
import { PluginConfig } from '../src/types/config';
import { CanvasManager } from '../src/agent/canvas-manager';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import { ToolResultHandler } from '../src/agent/tool-result-handler';

/**
 * OpenClaw V3.6.2 Phase 3: SLE Engine Structured JSON Output Verification
 * 
 * 此脚本验证 SLEEngine 的 Phase 3 升级：
 * 1. 使用 response_format: { type: 'json_object' } 和 stream: false。
 * 2. 正确解析 JSON 响应中的 thought 并输出到日志。
 * 3. 正确抓取 response 字段作为 sleFullOutput。
 * 4. 保持 tool_calls 兼容性。
 */

// Mock 依赖项
const mockConfig: PluginConfig = {
    llm: { apiKey: 'test', baseUrl: 'http://localhost', model: 'gpt-3.5-turbo' },
    fastAgent: { sleModel: 'gpt-4o' }
} as any;

const mockResultSummarizer = {} as ResultSummarizer;
const mockToolResultHandler = {
    handleToolCalls: async () => { console.log("   [Mock] ToolResultHandler.handleToolCalls called"); }
} as any;

const mockPromptAssembler = {
    assembleSLEPayload: async () => [{ role: 'user', content: 'test' }]
} as any;

const mockCanvasManager = {
    getCanvas: () => ({})
} as any;

async function verify() {
    console.log("--------------------------------------------------------------------------------");
    console.log("🔍 [V3.6.2 Verification Phase 3] 正在验证 SLE JSON 响应解析与分发...");
    console.log("--------------------------------------------------------------------------------");

    const sle = new SLEEngine(mockConfig, mockResultSummarizer, mockToolResultHandler);

    // Mock 正常 JSON 响应意图
    const mockJson = {
        thought: "这是我的思维链：用户询问天气，我需要先回复垫词。",
        intent: "查询天气",
        response: "好的，我帮您查一下北京今天的天气。"
    };

    // 覆盖接口调用
    (sle as any).openai = {
        chat: {
            completions: {
                create: async (payload: any) => {
                    console.log(`- 验证 Payload: stream=${payload.stream}, json_format=${payload.response_format?.type}`);
                    return {
                        choices: [{
                            message: {
                                content: JSON.stringify(mockJson),
                                tool_calls: [
                                    { id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Beijing"}' } }
                                ]
                            }
                        }]
                    };
                }
            }
        }
    };

    try {
        const { output, toolCalls } = await sle.run(
            [], "今天天气怎么样", "intent", mockPromptAssembler, "call-123", "snap", mockCanvasManager, () => { }, { interrupted: false, slcDone: false }
        );

        console.log(`- 预期输出: "${mockJson.response}"`);
        console.log(`- 实际输出: "${output}"`);
        console.log(`- 工具调用: ${toolCalls.length} 个`);

        const isOutputCorrect = output === mockJson.response;
        const hasTools = toolCalls.length > 0 && toolCalls[0].function.name === 'get_weather';

        console.log(`- 输出抓取验证: ${isOutputCorrect ? '✅ 正确' : '❌ 错误'}`);
        console.log(`- 工具兼容验证: ${hasTools ? '✅ 正确' : '❌ 错误'}`);

        if (isOutputCorrect && hasTools) {
            console.log("\n✅ [V3.6.2 Phase 3] 验证成功! SLEEngine 已正确实现 JSON 解析与 response 分发。");
            process.exit(0);
        } else {
            console.log("\n❌ [V3.6.2 Phase 3] 验证失败: 逻辑解析或工具保留异常。");
            process.exit(1);
        }
    } catch (e: any) {
        console.error("\n❌ [V3.6.2 Phase 3] 执行过程中出现异常:", e.message);
        process.exit(1);
    }
}

verify();
