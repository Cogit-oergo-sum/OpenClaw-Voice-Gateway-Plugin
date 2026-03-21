import { ResultSummarizer } from '../src/agent/result-summarizer';
import { PluginConfig } from '../src/types/config';

async function verify() {
    const config: PluginConfig = {
        llm: {
            apiKey: process.env.OPENAI_API_KEY || 'fake-key',
            baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
            model: 'gpt-4o-mini',
            provider: 'openai'
        },
        zego: {
            appId: 0,
            serverSecret: '',
            aiAgentBaseUrl: ''
        },
        tts: {
            vendor: '',
            appId: '',
            token: '',
            voiceType: ''
        }
    };

    const summarizer = new ResultSummarizer(config);

    console.log("--- 验证 ResultSummarizer ---");
    
    // 模拟 LLM 调用（或者是真实调用，如果有环境变量）
    try {
        const rawOutput = "文件列表: a.md, b.md, c.md\n任务耗时: 1.2s\n执行结果: 成功";
        const intent = "查看doc目录";
        const summary = await summarizer.summarizeTaskResult(rawOutput, intent);
        console.log("Input Output:", rawOutput);
        console.log("Summary Result:", summary);
        
        if (summary.includes("a.md") && !summary.includes("1.2s")) {
            console.log("✅ ResultSummarizer 验证成功: 提取了核心信息，过滤了噪音。");
        } else {
            console.log("⚠️ ResultSummarizer 验证异常: 可能包含噪音或缺失关键信息。");
        }
    } catch (e: any) {
        console.error("❌ ResultSummarizer 验证失败:", e.message);
    }
}

verify();
