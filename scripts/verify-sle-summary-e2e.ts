import * as path from 'path';
import { SLEEngine } from '../src/agent/sle';
import { PluginConfig } from '../src/types/config';

// Mock Config
const mockConfig: PluginConfig = {
    zego: { appId: 0, serverSecret: '', aiAgentBaseUrl: '' },
    llm: { 
        provider: 'openai', 
        apiKey: process.env.OPENAI_API_KEY || 'sk-xxxx', 
        model: 'qwen-turbo', 
        baseUrl: process.env.OPENAI_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1' 
    },
    tts: { vendor: 'zego', appId: '', token: '', voiceType: '' },
    fastAgent: {
        slcModel: 'qwen-turbo',
        sleModel: 'qwen-plus' // Use a slightly better model for extraction if possible
    }
};

async function testSummary() {
    console.log('🧪 Starting SLE Summary E2E Verification...');
    const sle = new SLEEngine(mockConfig);

    const testScenarios = [
        {
            name: "Success with Noise",
            intent: "查一下 openclaw-voice-gateway 目录下的文件",
            rawOutput: `
[2024-03-19 19:50:00] INFO: Starting file list task...
[2024-03-19 19:50:01] DEBUG: Scanning /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway...
Found items:
- src/
- web/
- package.json
- tsconfig.json
- .gitignore
Task finished in 1.2s.
Heartbeat: OK
`,
        },
        {
            name: "Explicit Failure",
            intent: "删除 test.txt 文件",
            rawOutput: `
[2024-03-19 19:51:00] ERROR: File not found.
Path: /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway/test.txt
Action: delete
Result: FAILED_NOT_FOUND
`,
        },
        {
            name: "Complex Data with Follow-up",
            intent: "查询明天的天气",
            rawOutput: `
Fetching weather data for Shanghai...
{
  "today": {"temp": "20C", "cond": "Clear"},
  "tomorrow": {"temp": "18C", "cond": "Rainy", "wind": "5km/h"},
  "extra": "Warning: Heavy rain expected tomorrow afternoon."
}
Status: OK
`,
        }
    ];

    for (const scenario of testScenarios) {
        console.log(`\n--- Scenario: ${scenario.name} ---`);
        console.log(`Intent: ${scenario.intent}`);
        
        try {
            // Use cast to any to access private method for testing
            const summary = await (sle as any).summarizeTaskResult(scenario.rawOutput, scenario.intent);
            console.log(`Summary Output:\n>>>>>>>>\n${summary}\n<<<<<<<<`);
            
            if (scenario.name === "Explicit Failure") {
                if (summary.includes("⚠️") || summary.includes("失败")) {
                    console.log("✅ Failure correctly tagged.");
                } else {
                    console.warn("❌ Failure marker missing!");
                }
            }
        } catch (e) {
            console.error(`❌ Scenario ${scenario.name} failed with error:`, e);
        }
    }

    console.log('\n✨ SLE Summary E2E Verification Finished.');
}

testSummary().catch(console.error);
