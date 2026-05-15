/**
 * 验证 qwen3.6-flash 关闭思考模式 + 工具调用时是否有文本输出
 */
import OpenAI from 'openai';

const API_KEY = 'sk-1aabae3cce604ddb82b78e315363beb2';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.6-flash';

const SYSTEM_PROMPT = `你是桃子，迎新助手。

# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
- ice_break: 破冰阶段
- phase_2_cooling: 深度闲聊阶段
- phase_3_conversion: 功能引导阶段

## 切换规则
当用户主动询问APP功能时，必须调用 mode_switch 工具切换到 phase_3_conversion。
同时输出一句简短的过渡语。
`;

const messages: any[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  // 模拟用户主动询问APP功能
  { role: 'user', content: '这个APP有什么好玩的？我想试试' }
];

const modeSwitchSchema = {
  type: 'function' as const,
  function: {
    name: 'mode_switch',
    description: '切换对话模式',
    parameters: {
      type: 'object',
      properties: {
        target_mode: {
          type: 'string',
          enum: ['ice_break', 'phase_2_cooling', 'phase_3_conversion']
        }
      },
      required: ['target_mode']
    }
  }
};

async function test(enableThinking: boolean) {
  console.log(`\n========================================`);
  console.log(`测试: enable_thinking = ${enableThinking}`);
  console.log(`========================================\n`);

  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

  // 构建请求参数（通过 extra_body 传递 DashScope 扩展参数）
  // Node.js OpenAI SDK 没有 extra_body，需要用其他方式
  // 方案：直接放在请求参数中，DashScope 会接受
  const requestParams: any = {
    model: MODEL,
    messages,
    tools: [modeSwitchSchema],
    stream: true,
    max_tokens: 100,
    temperature: 0.8
  };

  // 方案 A: 直接添加到请求参数（DashScope 兼容）
  if (!enableThinking) {
    requestParams.enable_thinking = false;
  }

  // 方案 B: 尝试通过 RequestOptions.body 传递
  const options: any = enableThinking ? {} : { body: { enable_thinking: false } };

  const startTime = Date.now();
  let firstTokenTime = 0;
  let fullText = '';
  let toolCallAccumulator: { id?: string; name?: string; arguments?: string } | null = null;
  let reasoningOutput = '';

  try {
    // 测试两种方案
    const stream = await client.chat.completions.create(requestParams) as any;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;

      if (content && firstTokenTime === 0) {
        firstTokenTime = Date.now();
        console.log(`首字延迟: ${firstTokenTime - startTime}ms`);
      }

      if (content) {
        fullText += content;
        process.stdout.write(content);
      }

      // 检查 reasoning_content (思考模式输出)
      const reasoning = (chunk.choices[0]?.delta as any)?.reasoning_content;
      if (reasoning) {
        reasoningOutput += reasoning;
      }

      // 累积 tool_calls
      if (chunk.choices[0]?.delta?.tool_calls) {
        const tcDelta = chunk.choices[0].delta.tool_calls[0];
        if (tcDelta) {
          if (!toolCallAccumulator) toolCallAccumulator = {};
          if (tcDelta.id) toolCallAccumulator.id = tcDelta.id;
          if (tcDelta.function?.name) toolCallAccumulator.name = tcDelta.function.name;
          if (tcDelta.function?.arguments) {
            toolCallAccumulator.arguments = (toolCallAccumulator.arguments || '') + tcDelta.function.arguments;
          }
        }
      }
    }

    const totalTime = Date.now() - startTime;

    console.log('\n\n--- 结果 ---');
    console.log(`总延迟: ${totalTime}ms`);
    console.log(`思考过程: ${reasoningOutput ? `${reasoningOutput.length} 字` : '(无)'}`);
    console.log(`文本输出: "${fullText || '(空)'}"`);
    console.log(`工具调用: ${toolCallAccumulator ? toolCallAccumulator.name : '(无)'}`);
    if (toolCallAccumulator?.arguments) {
      try {
        const args = JSON.parse(toolCallAccumulator.arguments);
        console.log(`target_mode: ${args.target_mode}`);
      } catch (e) {
        console.log(`arguments: ${toolCallAccumulator.arguments}`);
      }
    }

  } catch (e: any) {
    console.error(`错误: ${e.message}`);
  }
}

async function main() {
  // 测试 1: 默认开启思考模式
  await test(true);

  // 测试 2: 关闭思考模式
  await test(false);
}

main();