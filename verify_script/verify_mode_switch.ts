import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';

const TEST_API_KEY = process.env.OPENAI_API_KEY || process.env.SLC_API_KEY;
const TEST_BASE_URL = process.env.SLC_BASE_URL || 'https://api.openai.com/v1';
const TEST_MODEL = process.env.SLC_MODEL || 'gpt-4o-mini';

// 模拟的模式定义
const MODES = {
  working: {
    description: '工作汇报模式：专注职场话题，高效沟通',
    prompt: `# 工作汇报模式\n你正在扮演一个职场助手，帮助用户高效处理工作事务。\n\n## 行为指南\n- 简洁高效，直接解决问题\n- 优先工作相关话题\n\n## 【切换规则 - 必须调用工具】\n当用户说"休息一下"、"玩个游戏"等非工作相关话题时，**必须立即调用mode_switch工具**。\n\n注意：你**不能**只在文本中说"切换到游戏模式"，必须调用工具才能切换。可以先说一句简短的过渡语如"好的，换个话题~"，然后调用mode_switch(target_mode="game")。`
  },
  game: {
    description: '玩游戏模式：轻松娱乐，陪用户玩游戏或聊游戏话题',
    prompt: `# 玩游戏模式\n你现在是一个游戏伙伴，陪用户聊游戏或玩文字游戏。\n\n## 行为指南\n- 轻松活泼的语气\n- 可以推荐游戏、聊游戏话题\n\n## 【切换规则 - 必须调用工具】\n当用户说"继续工作"、"回到正事"时，**必须立即调用mode_switch工具**。\n\n注意：你**不能**只在文本中说"切换到工作模式"，必须调用工具才能切换。可以先说一句简短的过渡语如"好的，回到正事~"，然后调用mode_switch(target_mode="working")。`
  }
};

// 动态生成工具schema
function getModeSwitchSchema(): OpenAI.ChatCompletionTool {
  return {
    type: 'function' as const,
    function: {
      name: 'mode_switch',
      description: '切换对话模式/场景。根据用户话题变化，切换到合适的模式。',
      parameters: {
        type: 'object',
        properties: {
          target_mode: {
            type: 'string',
            enum: Object.keys(MODES),
            description: '要切换到的目标模式'
          },
          context: {
            type: 'object',
            description: '切换时可携带的上下文信息（如用户兴趣等）'
          }
        },
        required: ['target_mode']
      }
    }
  };
}

// System Prompt (包含模式概述)
function getSystemPrompt() {
  return `你是 Jarvis，一个智能助手。

# 模式切换能力（非常重要！）
你拥有切换对话模式的能力。当前可用的模式有：
- working: ${MODES.working.description}
- game: ${MODES.game.description}

## 切换规则（必须遵守）
当用户话题需要切换模式时，你**必须**调用mode_switch工具，**不能**只在文本中说"切换模式"。
- 切换时可以同时输出简短的过渡语（如"好的，换个话题~"）
- 但必须调用mode_switch工具才能实际切换

# 语音输出规范
- 严禁Markdown格式
- 输出总长度在60字以内`;
}

interface TestResult {
  scenario: string;
  input: string;
  output_text: string;
  tool_call: any;
  ttft_ms: number;
  total_ms: number;
  passed: boolean;
  notes: string;
}

async function runTest(
  client: OpenAI,
  scenario: string,
  userInput: string,
  currentMode: string,
  expectation: { shouldSwitch?: string; shouldNotSwitch?: boolean }
): Promise<TestResult> {
  const startTime = Date.now();
  let ttft = 0;
  let outputText = '';
  let toolCall: any = null;

  const messages: any[] = [
    { role: 'system', content: getSystemPrompt() },
    { role: 'user', content: `[模式引导]\n${MODES[currentMode as keyof typeof MODES].prompt}` },
    { role: 'user', content: userInput }
  ];

  try {
    const stream = await client.chat.completions.create({
      model: TEST_MODEL,
      messages,
      tools: [getModeSwitchSchema()],
      tool_choice: 'auto',  // 明确指定 tool_choice
      stream: true,
      max_tokens: 100
    });

    let firstToken = true;
    let toolCallAccumulator: { index: number; id?: string; name?: string; arguments?: string } | null = null;

    for await (const chunk of stream) {
      if (firstToken && (chunk.choices[0]?.delta?.content || chunk.choices[0]?.delta?.tool_calls)) {
        ttft = Date.now() - startTime;
        firstToken = false;
      }

      const content = chunk.choices[0]?.delta?.content;
      if (content) outputText += content;

      // 检测tool_calls (流式增量，需要累积)
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
    }

    // 流结束后，解析完整的 tool_call
    if (toolCallAccumulator) {
      toolCall = {
        id: toolCallAccumulator.id,
        type: 'function',
        function: {
          name: toolCallAccumulator.name,
          arguments: toolCallAccumulator.arguments || '{}'
        }
      };
    }

    const totalMs = Date.now() - startTime;

    // 判断是否通过
    let passed = false;
    let notes = '';

    if (expectation.shouldSwitch) {
      if (toolCall?.function?.name === 'mode_switch') {
        const args = JSON.parse(toolCall.function.arguments || '{}');
        if (args.target_mode === expectation.shouldSwitch) {
          passed = true;
          notes = `正确切换到 ${args.target_mode}`;
          if (args.context) {
            notes += `, context: ${JSON.stringify(args.context)}`;
          }
        } else {
          notes = `切换到了 ${args.target_mode}，期望 ${expectation.shouldSwitch}`;
        }
      } else {
        notes = '期望切换但未触发tool_call';
      }
    } else if (expectation.shouldNotSwitch) {
      if (!toolCall) {
        passed = true;
        notes = '正确保持模式';
      } else {
        notes = `期望不切换但触发了 ${toolCall?.function?.name}`;
      }
    }

    return {
      scenario,
      input: userInput,
      output_text: outputText,
      tool_call: toolCall,
      ttft_ms: ttft,
      total_ms: totalMs,
      passed,
      notes
    };
  } catch (e: any) {
    return {
      scenario,
      input: userInput,
      output_text: '',
      tool_call: null,
      ttft_ms: 0,
      total_ms: 0,
      passed: false,
      notes: `Error: ${e.message}`
    };
  }
}

async function verify() {
  console.log('🚀 Starting Mode Switch Verification...');
  console.log(`Model: ${TEST_MODEL}, BaseURL: ${TEST_BASE_URL}`);

  if (!TEST_API_KEY) {
    console.error('❌ Missing API Key. Set OPENAI_API_KEY or SLC_API_KEY');
    process.exit(1);
  }

  const client = new OpenAI({
    apiKey: TEST_API_KEY,
    baseURL: TEST_BASE_URL
  });

  const testCases = [
    { scenario: '保持工作模式', input: '帮我整理一下今天的会议纪要', mode: 'working', expect: { shouldNotSwitch: true } },
    { scenario: '切换到游戏模式', input: '累了，玩个游戏吧', mode: 'working', expect: { shouldSwitch: 'game' } },
    { scenario: '带context切换', input: '我喜欢射击类游戏，换到游戏模式', mode: 'working', expect: { shouldSwitch: 'game' } },
    { scenario: '保持游戏模式', input: '今天有什么好玩的游戏推荐', mode: 'game', expect: { shouldNotSwitch: true } },
    { scenario: '回退工作模式', input: '休息够了，继续工作', mode: 'game', expect: { shouldSwitch: 'working' } },
  ];

  const results: TestResult[] = [];

  for (const tc of testCases) {
    console.log(`\n📋 Testing: ${tc.scenario}`);
    console.log(`   Input: "${tc.input}" (当前模式: ${tc.mode})`);

    const result = await runTest(client, tc.scenario, tc.input, tc.mode, tc.expect);
    results.push(result);

    console.log(`   Output: "${result.output_text.substring(0, 50)}..."`);
    console.log(`   Tool Call: ${result.tool_call ? JSON.stringify(result.tool_call.function) : 'None'}`);
    console.log(`   TTFT: ${result.ttft_ms}ms, Total: ${result.total_ms}ms`);
    console.log(`   Result: ${result.passed ? '✅ PASS' : '❌ FAIL'} - ${result.notes}`);
  }

  // 统计
  const passCount = results.filter(r => r.passed).length;
  const avgTtft = results.reduce((sum, r) => sum + r.ttft_ms, 0) / results.length;
  const avgTotal = results.reduce((sum, r) => sum + r.total_ms, 0) / results.length;

  console.log('\n========================================');
  console.log(`📊 Summary:`);
  console.log(`   Pass Rate: ${passCount}/${results.length} (${(passCount/results.length*100).toFixed(1)}%)`);
  console.log(`   Avg TTFT: ${avgTtft.toFixed(0)}ms`);
  console.log(`   Avg Total: ${avgTotal.toFixed(0)}ms`);
  console.log('========================================\n');

  // 检查延迟是否满足要求 (TTFT < 600ms)
  const ttftOk = avgTtft < 600;
  console.log(`TTFT Requirement (<600ms): ${ttftOk ? '✅ PASS' : '❌ FAIL'}`);

  // 检查准确率 (>80%)
  const accuracyOk = passCount / results.length > 0.8;
  console.log(`Accuracy Requirement (>80%): ${accuracyOk ? '✅ PASS' : '❌ FAIL'}`);

  if (passCount === results.length && ttftOk) {
    console.log('\n✅ ALL TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('\n❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

verify().catch(e => {
  console.error('\n❌ VERIFICATION FAILED:');
  console.error(e);
  process.exit(1);
});