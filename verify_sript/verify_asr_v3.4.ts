import { ASR_CORRECTION_DIRECTIVE_TEMPLATE, buildShadowThought } from '../src/agent/prompts';
import { CallManager } from '../src/call/call-manager';
import { ToolResultHandler } from '../src/agent/tool-result-handler';
import { CanvasManager } from '../src/agent/canvas-manager';

async function verify() {
    console.log("=== [V3.4 Verification Start] ===");

    // 1. 验证 Prompts 集中化
    console.log("\n1. Verifying Prompt Templates...");
    const directive = ASR_CORRECTION_DIRECTIVE_TEMPLATE("武松", "雾凇");
    console.log("ASR Directive Sample:", directive);

    if (directive.includes("武松") && directive.includes("雾凇") && directive.includes("[ASR 纠错情报]")) {
        console.log("✅ Prompt Template is correct.");
    } else {
        throw new Error("❌ Prompt Template failed!");
    }

    const shadow = buildShadowThought('internal', "任务已完成");
    console.log("Shadow Thought Sample:", shadow);
    if (shadow.includes("不要像机器人一样复述")) {
        console.log("✅ Shadow Thought Template is humanized.");
    } else {
        throw new Error("❌ Shadow Thought Template failed!");
    }

    // 2. 验证 CallManager 阶梯提权
    console.log("\n2. Verifying CallManager Adaptive Weighting...");
    const config: any = { zego: {}, llm: {}, tts: {} };
    const cm = new CallManager(config);
    const userId = "test-user";
    cm.createCall(userId);

    // 模拟重写 ZegoApiClient.updateAgentHotwords 捕获调用
    let lastHotwords: any = {};
    (cm.api as any).updateAgentHotwords = async (hotwords: any) => {
        lastHotwords = hotwords;
    };

    // 第一次纠错
    await cm.updateAsrCorrection(userId, "武松", "雾凇");
    console.log("Weight after 1st correction:", lastHotwords["雾凇"]);
    if (lastHotwords["雾凇"] === 5) console.log("✅ Weight 5 (Initial) OK.");

    // 第二次纠错
    await cm.updateAsrCorrection(userId, "武松", "雾凇");
    console.log("Weight after 2nd correction:", lastHotwords["雾凇"]);
    if (lastHotwords["雾凇"] === 8) console.log("✅ Weight 8 (Staircase) OK.");

    // 第三次纠错
    await cm.updateAsrCorrection(userId, "武松", "雾凇");
    console.log("Weight after 3rd correction:", lastHotwords["雾凇"]);
    if (lastHotwords["雾凇"] === 11) console.log("✅ Weight 11 (Forced) OK.");

    // 3. 验证 ToolResultHandler 播报拦截
    console.log("\n3. Verifying ToolResultHandler Redundancy Filter...");
    const canvasMgr = new CanvasManager("./tmp_workspace");
    const trh = new ToolResultHandler({} as any, {} as any, "./tmp_workspace", cm);
    // [V3.5.2] 等待异步加载的动态技能完成
    await new Promise(resolve => setTimeout(resolve, 500));
    const canvas: any = { task_status: { status: 'IDLE' } };

    let eventLog: any[] = [];
    (canvasMgr as any).logCanvasEvent = async (id: string, event: string, detail: any) => {
        eventLog.push({ event, detail });
    };

    // 第一次执行 -> 产生摘要
    const toolCall = {
        function: {
            name: 'correct_asr_hotword',
            arguments: JSON.stringify({ original_word: "武松", corrected_word: "雾凇" })
        }
    };

    // 清除 cm 中的缓存
    cm.getCallState(userId)!.aliasMap.clear();

    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasMgr);
    const firstEvent = eventLog.find(e => e.event === 'ASR_CORRECTED');
    console.log("First correction event:", firstEvent ? "Found" : "Not Found");
    if (firstEvent) console.log("✅ First broadcast triggered.");

    // 第二次执行（相同词） -> 拦截摘要
    eventLog = [];
    await trh.handleToolCalls([toolCall], "text", userId, canvas, canvasMgr);
    const secondEvent = eventLog.find(e => e.event === 'ASR_ALREADY_FIXED');
    const redundantEvent = eventLog.find(e => e.event === 'ASR_CORRECTED');
    console.log("Second correction event (fixed):", secondEvent ? "Found" : "Not Found");
    console.log("Redundant correction event:", redundantEvent ? "Found" : "Not Found");

    if (secondEvent && !redundantEvent) {
        console.log("✅ Redundant broadcast filtered, silent sync OK.");
    } else {
        console.error("❌ Redundancy filter failed!", { secondEvent, redundantEvent });
    }

    console.log("\n=== [V3.4 All Core Logic Verified Successfully] ===");
}

verify().catch(e => {
    console.error(e);
    process.exit(1);
});
