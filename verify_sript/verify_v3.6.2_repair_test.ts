import { SLEEngine } from '../src/agent/sle';
import { PluginConfig } from '../src/types/config';
import { CanvasManager } from '../src/agent/canvas-manager';
import { SkillRegistry } from '../src/agent/skills';
import { SLE_ACTION_PROTOCOL } from '../src/agent/prompts';
import * as fs from 'fs';
import * as path from 'path';

async function verifyRepair() {
    console.log("====================================================");
    console.log("🔍 [V3.6.2 Fix Verification] 验证 Auto-Repair 与分流逻辑...");
    console.log("====================================================");

    // 1. 验证 Prompt 包含“Slug”指令
    console.log("\n1. 检查 Prompt 包含工具 Slug 指令...");
    if (SLE_ACTION_PROTOCOL.includes("必须填写具体的工具标识符（Slug") &&
        SLE_ACTION_PROTOCOL.includes("weather_mcp")) {
        console.log("✅ Prompt 已更新，包含 Slug 指令。");
    } else {
        console.error("❌ Prompt 未发现 Slug 相关指令！");
        process.exit(1);
    }

    // 2. 验证 SLE 修复逻辑
    console.log("\n2. 模拟模型输出 'Intent Only' 场景 (触发 Auto-Repair)...");

    // 注册一个模拟技能
    const registry = SkillRegistry.getInstance();
    (registry as any).skills.set('weather_mcp', {
        name: 'weather_mcp',
        description: 'Check weather',
        parameters: {
            type: 'object',
            properties: {
                city: { type: 'string' }
            }
        },
        isLongRunning: true
    });

    const mockConfig: PluginConfig = {
        llm: { apiKey: 'dummy', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
        fastAgent: { sleModel: 'gpt-4o' }
    } as any;
    const toolResultHandler = { handleToolCalls: async () => { } } as any;
    const canvasManager = { getCanvas: () => ({ env: {}, task_status: {}, context: {} }) } as any;
    const promptAssembler = { assembleSLEPayload: () => [] } as any;
    const sle = new SLEEngine(mockConfig, {} as any, toolResultHandler);

    // Mock OpenAI (没有 tool_calls, 只有 JSON intent)
    const mockContent = JSON.stringify({
        thought: "Thinking...",
        intent: "weather_mcp",
        response: "好的，帮您查一下。"
    });

    (sle as any).openai = {
        chat: {
            completions: {
                create: async () => ({
                    choices: [{ message: { content: mockContent, tool_calls: [] } }]
                })
            }
        }
    };

    const result = await sle.run([], "深圳天气", "weather_mcp", promptAssembler, "test", "{}", canvasManager, () => { }, { interrupted: false, slcDone: false }, "test");

    console.log("   - 返回结果 Intent:", result.intent);
    const firstCall = result.toolCalls[0];
    const args = JSON.parse(firstCall.function.arguments);
    console.log("   - 修复后的参数:", JSON.stringify(args));

    if (result.intent === "weather_mcp" && args.city === "深圳天气") {
        console.log("✅ Auto-Repair 成功！已根据 Skill Schema 自动补全 city 参数为 '深圳天气'。");
    } else {
        console.error("❌ Auto-Repair 失败或映射逻辑错误！收到参数:", JSON.stringify(args));
        process.exit(1);
    }

    // 3. 验证分流逻辑 (由于逻辑在 Orchestrator 私有方法或闭包中，我们通过读取文件逻辑确认)
    console.log("\n3. 静态检查 Orchestrator 分流逻辑...");
    const orchPath = path.join(process.cwd(), 'src/agent/agent-orchestrator.ts');
    const orchContent = fs.readFileSync(orchPath, 'utf8');

    const hasRefiningGuard = orchContent.includes("!sleResult.intent") && orchContent.includes("Refining");
    if (hasRefiningGuard) {
        console.log("✅ Orchestrator 包含 !intent 守卫，已具备防止幻觉垫词的能力。");
    } else {
        console.error("❌ Orchestrator 缺失 !intent 守卫！");
        process.exit(1);
    }

    console.log("\n✨ [V3.6.2 Fix] 验证通过！系统已具备自动修复和幻觉抑制能力。");
    process.exit(0);
}

verifyRepair().catch(e => {
    console.error(e);
    process.exit(1);
});
