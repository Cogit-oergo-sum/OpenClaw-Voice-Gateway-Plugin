import { SLEEngine } from '../src/agent/sle';
import { PluginConfig } from '../src/types/config';
import { CanvasManager } from '../src/agent/canvas-manager';
import { DialogueMemory } from '../src/agent/dialogue-memory';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { ResultSummarizer } from '../src/agent/result-summarizer';
import { ToolResultHandler } from '../src/agent/tool-result-handler';
import * as fs from 'fs';
import * as path from 'path';

/**
 * OpenClaw V3.6.2 Final Regression & Audit
 */

const mockConfig: PluginConfig = {
    llm: { apiKey: 'sk-test', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    fastAgent: { sleModel: 'gpt-4o' }
} as any;

async function verify() {
    console.log("================================================================================");
    console.log("🚀 [V3.6.2 Final Regression] 启动全链路回归验证...");
    console.log("================================================================================");

    const logPath = path.join(process.cwd(), '.llm_requests.log');
    if (fs.existsSync(logPath)) fs.unlinkSync(logPath); // 清理旧日志

    const workspaceRoot = "./";
    const canvasManager = new CanvasManager(workspaceRoot);
    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const resultSummarizer = {} as ResultSummarizer;
    const toolResultHandler = {
        handleToolCalls: async () => { }
    } as any;
    const promptAssembler = new PromptAssembler(workspaceRoot, dialogueMemory, canvasManager);
    const sle = new SLEEngine(mockConfig, resultSummarizer, toolResultHandler);

    // Mock OpenAI 响应
    const mockResponse = {
        choices: [{
            message: {
                content: JSON.stringify({
                    thought: "用户询问北京天气，我需要调用查询工具。",
                    intent: "查询天气",
                    response: "好的，我来查一下北京的天气。"
                }),
                tool_calls: [
                    { id: 'call_1', function: { name: 'get_weather', arguments: '{"city":"Beijing"}' } }
                ]
            }
        }]
    };

    (sle as any).openai = {
        chat: {
            completions: {
                create: async (payload: any) => {
                    return mockResponse;
                }
            }
        }
    };

    const callId = "test-call-final";
    const dialogueHistory = [
        { role: 'user', content: '你好' },
        { role: 'assistant', content: '您好，我是 OpenClaw 助手，请问有什么可以帮您？' }
    ];

    console.log("1. 执行 SLEEngine.run (模拟查询天气)...");
    await sle.run(
        dialogueHistory,
        "北京今天天气怎么样？",
        "查询天气",
        promptAssembler,
        callId,
        '{"active_tasks": []}',
        canvasManager,
        () => { },
        { interrupted: false, slcDone: false }
    );

    console.log("2. 审计 .llm_requests.log 中的 Payload 布局...");
    const logs = fs.readFileSync(logPath, 'utf8').split('\n').filter(l => l.trim() !== '');
    const decidingLog = logs.find(l => JSON.parse(l).scenario === 'DECIDING');

    if (!decidingLog) {
        console.error("❌ 错误：未在日志中找到 DECIDING 场景记录。");
        process.exit(1);
    }

    const entry = JSON.parse(decidingLog);
    const messages = entry.request;

    // 验证分层标准
    // 1. System
    // 2. User (Snapshot)
    // 3. History (History)
    // 4. User (Current Input)

    const layer1 = messages[0].role === 'system';
    const layer2 = messages[1].role === 'user' && (messages[1].content.includes('[Canvas Snapshot]') || messages[1].content.includes('[Context]'));

    // Find the current input (last message if it matches)
    const currentInputMsg = messages[messages.length - 1];
    const layer4 = currentInputMsg.role === 'user' && currentInputMsg.content === '北京今天天气怎么样？';

    console.log(`- Layer 1 (System): ${layer1 ? '✅' : '❌'}`);
    console.log(`- Layer 2 (Snapshot): ${layer2 ? '✅' : '❌'}`);
    console.log(`- Layer 4 (Current Input): ${layer4 ? '✅' : '❌'}`);

    // 检查 Shadow Thought 净化
    const hasShadowThought = messages.some((m: any) => m.role === 'assistant' && m.content.includes('(shadow thought)'));
    console.log(`- Shadow Thought 净化检查: ${!hasShadowThought ? '✅ 已净化' : '❌ 仍存在'}`);

    // 检查结果格式
    const responseJson = JSON.parse(entry.response);
    const hasThought = !!responseJson.thought;
    const hasResponse = !!responseJson.response;
    console.log(`- SLE 响应 JSON 格式检查: ${hasThought && hasResponse ? '✅' : '❌'}`);

    if (layer1 && layer2 && layer4 && !hasShadowThought && hasThought && hasResponse) {
        console.log("\n✨ [V3.6.2 Final] 全链路回归及审计成功！系统架构完全符合 V3.6.2 规范。");
        process.exit(0);
    } else {
        console.log("\n❌ [V3.6.2 Final] 验证失败：存在不符合架构标准的 Payload 布局。");
        process.exit(1);
    }
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
