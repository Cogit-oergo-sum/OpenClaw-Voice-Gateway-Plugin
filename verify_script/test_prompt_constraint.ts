/**
 * 验证方案A：提示词约束能否让 qwen3.6-flash 调用工具时输出文本
 *
 * 测试目标：
 * - 添加明确的提示词约束："调用工具前必须先输出一段简短的过渡语"
 * - 验证是否能让模型同时输出文本 + tool_call
 */
import OpenAI from 'openai';

const API_KEY = 'sk-1aabae3cce604ddb82b78e315363beb2';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.6-flash';

// 方案A：增强提示词约束
const SYSTEM_PROMPT_WITH_CONSTRAINT = `你是桃子，迎新助手。

# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
- ice_break: 破冰阶段
- phase_2_cooling: 深度闲聊阶段
- phase_3_conversion: 功能引导阶段

## 切换规则
当用户主动询问APP功能时，必须调用 mode_switch 工具切换到 phase_3_conversion。

## 【重要约束】工具调用输出规范
**调用任何工具之前，你必须先输出一段简短的过渡语（10-20字），让用户感知到你的响应。**
例如：
- "好的，换个话题~"
- "嗯，我来帮你看看~"
- "了解，让我切换一下~"

绝不能只调用工具而不输出任何文本内容！`;

const SYSTEM_PROMPT_NO_CONSTRAINT = `你是桃子，迎新助手。

# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
- ice_break: 破冰阶段
- phase_2_cooling: 深度闲聊阶段
- phase_3_conversion: 功能引导阶段

## 切换规则
当用户主动询问APP功能时，必须调用 mode_switch 工具切换到 phase_3_conversion。`;

// 模拟超过20轮对话历史（用户主动询问APP功能）
const buildMessages = (systemPrompt: string): any[] => [
  { role: 'system', content: systemPrompt },
  // 模拟对话历史
  { role: 'user', content: '哈喽呀' },
  { role: 'assistant', content: '哈喽哈喽，你是第一次来咱们这儿玩吗？' },
  { role: 'user', content: '是的' },
  { role: 'assistant', content: '欢迎欢迎！这都六点半了，你是刚下班想放松一下吗？' },
  { role: 'user', content: '对的，有点累' },
  { role: 'assistant', content: '哎呀上班确实辛苦，你是想听歌放松下还是聊聊解压？' },
  { role: 'user', content: '聊聊吧' },
  { role: 'assistant', content: '好呀，平时有什么爱好吗？打游戏还是看剧？' },
  { role: 'user', content: '偶尔打打游戏' },
  { role: 'assistant', content: '打游戏挺解压的，你玩什么游戏呀？' },
  { role: 'user', content: '王者' },
  { role: 'assistant', content: '王者我也玩过！你常用什么英雄呀？' },
  { role: 'user', content: '打野比较多' },
  { role: 'assistant', content: '打野最考验意识了！你有没有遇到过特别坑的队友？' },
  { role: 'user', content: '太多了哈哈' },
  { role: 'assistant', content: '哈哈太懂了，有时候真的想把手机摔了。你平时和朋友开黑吗？' },
  { role: 'user', content: '偶尔会' },
  { role: 'assistant', content: '开黑更有意思，语音聊天配合默契度拉满。对了，你除了王者还玩别的吗？' },
  { role: 'user', content: '原神也玩一点' },
  { role: 'assistant', content: '原神大世界探索很沉浸呀！你最喜欢哪个角色？' },
  { role: 'user', content: '钟离吧' },
  { role: 'assistant', content: '钟离那个配音太绝了！低沉又稳重。你平时喜欢听什么类型的歌呀？' },
  // 关键转折：用户主动询问APP功能
  { role: 'user', content: '对了，这个APP有什么好玩的吗？我想试试' }
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

async function test(promptType: 'with_constraint' | 'no_constraint') {
  console.log(`\n========================================`);
  console.log(`测试: ${promptType === 'with_constraint' ? '方案A - 提示词约束' : '对照组 - 无约束'}`);
  console.log(`========================================\n`);

  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const systemPrompt = promptType === 'with_constraint'
    ? SYSTEM_PROMPT_WITH_CONSTRAINT
    : SYSTEM_PROMPT_NO_CONSTRAINT;
  const messages = buildMessages(systemPrompt);

  const startTime = Date.now();
  let firstTokenTime = 0;
  let fullText = '';
  let toolCallAccumulator: { id?: string; name?: string; arguments?: string } | null = null;

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: [modeSwitchSchema],
      stream: true,
      max_tokens: 100,
      temperature: 0.8,
      enable_thinking: false
    } as any) as any;

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

    // 判断成功与否
    const hasText = fullText.length > 0;
    const hasToolCall = toolCallAccumulator?.name === 'mode_switch';

    if (promptType === 'with_constraint') {
      if (hasText && hasToolCall) {
        console.log('\n✅ 方案A 命中！模型同时输出文本 + 工具调用');
        return true;
      } else if (hasToolCall && !hasText) {
        console.log('\n❌ 方案A 失败！模型只调用工具，无文本输出');
        return false;
      } else if (hasText && !hasToolCall) {
        console.log('\n⚠️ 模型只输出文本，未调用工具（提示词可能约束了工具调用）');
        return false;
      }
    } else {
      // 对照组
      console.log(`\n📊 对照组结果: 文本=${hasText}, 工具=${hasToolCall}`);
      return { hasText, hasToolCall };
    }

  } catch (e: any) {
    console.error(`错误: ${e.message}`);
    return false;
  }
}

async function main() {
  // 先测对照组
  const controlResult = await test('no_constraint');

  // 再测方案A
  const success = await test('with_constraint');

  console.log('\n========================================');
  console.log('最终结论:');
  if (success) {
    console.log('✅ 方案A（提示词约束）有效，可以让模型输出文本 + 工具调用');
    process.exit(0);
  } else {
    console.log('❌ 方案A（提示词约束）无效，需要采用方案B（代码兜底）');
    process.exit(1);
  }
}

main();