/**
 * 多模型对比验证：测试不同模型在调用工具时是否输出文本
 *
 * 测试目标：
 * 1. 无约束时：各模型是否天然支持 mixed response（文本 + tool_call）
 * 2. 有约束时：约束是否对各模型都有效
 */
import OpenAI from 'openai';

// 可配置测试多个模型
const TEST_MODELS = [
  // DashScope 模型
  { name: 'qwen3.6-flash', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-1aabae3cce604ddb82b78e315363beb2' },
  { name: 'qwen-plus', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: 'sk-1aabae3cce604ddb82b78e315363beb2' },
  // 如果有其他模型 API key，可以添加：
  // { name: 'gpt-4o-mini', baseUrl: 'https://api.openai.com/v1', apiKey: process.env.OPENAI_API_KEY },
];

const SYSTEM_PROMPT_NO_CONSTRAINT = `你是桃子，迎新助手。

# 模式切换能力
当用户主动询问APP功能时，必须调用 mode_switch 工具切换到 phase_3_conversion。`;

const SYSTEM_PROMPT_WITH_CONSTRAINT = `你是桃子，迎新助手。

# 模式切换能力
当用户主动询问APP功能时，必须调用 mode_switch 工具切换到 phase_3_conversion。

## 【重要约束】工具调用输出规范
**调用任何工具之前，你必须先输出一段简短的过渡语（10-20字）。**
绝不能只调用工具而不输出任何文本内容！`;

const buildMessages = (systemPrompt: string): any[] => [
  { role: 'system', content: systemPrompt },
  // 完整的20+轮对话历史（从单点测试脚本复制）
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

interface TestResult {
  model: string;
  scenario: 'no_constraint' | 'with_constraint';
  hasText: boolean;
  hasToolCall: boolean;
  textOutput: string;
  ttftMs: number;
  totalMs: number;
}

async function testModel(
  modelName: string,
  baseUrl: string,
  apiKey: string,
  scenario: 'no_constraint' | 'with_constraint'
): Promise<TestResult> {
  const client = new OpenAI({ apiKey, baseURL: baseUrl });
  const systemPrompt = scenario === 'with_constraint'
    ? SYSTEM_PROMPT_WITH_CONSTRAINT
    : SYSTEM_PROMPT_NO_CONSTRAINT;
  const messages = buildMessages(systemPrompt);

  const startTime = Date.now();
  let firstTokenTime = 0;
  let fullText = '';
  let toolCallAccumulator: { id?: string; name?: string; arguments?: string } | null = null;

  try {
    const stream = await client.chat.completions.create({
      model: modelName,
      messages,
      tools: [modeSwitchSchema],
      stream: true,
      max_tokens: 100,
      temperature: 0.8,
      // qwen 系列需要关闭思考模式
      ...(modelName.includes('qwen') ? { enable_thinking: false } : {})
    } as any) as any;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;

      if (content && firstTokenTime === 0) {
        firstTokenTime = Date.now();
      }

      if (content) {
        fullText += content;
      }

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

    return {
      model: modelName,
      scenario,
      hasText: fullText.length > 0,
      hasToolCall: toolCallAccumulator?.name === 'mode_switch',
      textOutput: fullText.substring(0, 30) || '(空)',
      ttftMs: firstTokenTime > 0 ? firstTokenTime - startTime : 0,
      totalMs: Date.now() - startTime
    };
  } catch (e: any) {
    console.error(`  ❌ ${modelName} 测试失败: ${e.message}`);
    return {
      model: modelName,
      scenario,
      hasText: false,
      hasToolCall: false,
      textOutput: `ERROR: ${e.message}`,
      ttftMs: 0,
      totalMs: 0
    };
  }
}

async function main() {
  console.log('🧪 多模型工具调用行为对比测试\n');
  console.log('测试场景：用户询问APP功能，触发 mode_switch\n');

  const results: TestResult[] = [];

  for (const modelConfig of TEST_MODELS) {
    console.log(`\n========================================`);
    console.log(`模型: ${modelConfig.name}`);
    console.log(`========================================`);

    // 测试无约束
    console.log('\n[1] 无约束测试...');
    const noConstraint = await testModel(
      modelConfig.name,
      modelConfig.baseUrl,
      modelConfig.apiKey,
      'no_constraint'
    );
    results.push(noConstraint);
    console.log(`  文本: ${noConstraint.hasText ? `"${noConstraint.textOutput}"` : '(空)'}`);
    console.log(`  工具: ${noConstraint.hasToolCall ? 'mode_switch' : '(无)'}`);
    console.log(`  延迟: TTFT=${noConstraint.ttftMs}ms, Total=${noConstraint.totalMs}ms`);

    // 测试有约束
    console.log('\n[2] 提示词约束测试...');
    const withConstraint = await testModel(
      modelConfig.name,
      modelConfig.baseUrl,
      modelConfig.apiKey,
      'with_constraint'
    );
    results.push(withConstraint);
    console.log(`  文本: ${withConstraint.hasText ? `"${withConstraint.textOutput}"` : '(空)'}`);
    console.log(`  工具: ${withConstraint.hasToolCall ? 'mode_switch' : '(无)'}`);
    console.log(`  延迟: TTFT=${withConstraint.ttftMs}ms, Total=${withConstraint.totalMs}ms`);
  }

  // 输出对比表
  console.log('\n\n========================================');
  console.log('📊 模型对比总结');
  console.log('========================================\n');

  console.log('| 模型 | 无约束(文本/工具) | 有约束(文本/工具) | 约束效果 |');
  console.log('|------|-------------------|-------------------|----------|');

  for (const modelConfig of TEST_MODELS) {
    const noConstraintResult = results.find(r => r.model === modelConfig.name && r.scenario === 'no_constraint')!;
    const withConstraintResult = results.find(r => r.model === modelConfig.name && r.scenario === 'with_constraint')!;

    const noTextTool = `${noConstraintResult.hasText ? '✅' : '❌'}/${noConstraintResult.hasToolCall ? '✅' : '❌'}`;
    const withTextTool = `${withConstraintResult.hasText ? '✅' : '❌'}/${withConstraintResult.hasToolCall ? '✅' : '❌'}`;

    let effect = '';
    if (!noConstraintResult.hasText && withConstraintResult.hasText && withConstraintResult.hasToolCall) {
      effect = '✅ 约束有效';
    } else if (noConstraintResult.hasText && noConstraintResult.hasToolCall) {
      effect = '⚡ 天然支持';
    } else if (!noConstraintResult.hasText && !noConstraintResult.hasToolCall) {
      effect = '⚠️ 工具未触发';
    } else if (noConstraintResult.hasText && !noConstraintResult.hasToolCall) {
      effect = '⚠️ 约束抑制工具';
    } else {
      effect = '❓ 其他';
    }

    console.log(`| ${modelConfig.name} | ${noTextTool} | ${withTextTool} | ${effect} |`);
  }

  console.log('\n说明：');
  console.log('  ✅ 文本/工具 = 模型输出文本且调用工具');
  console.log('  ❌ 文本 = 模型未输出文本');
  console.log('  "天然支持" = 无约束就能同时输出文本+工具');
  console.log('  "约束有效" = 无约束只输出工具，有约束后同时输出');
  console.log('  "约束抑制工具" = 约束让模型只输出文本，不调用工具（副作用）');
}

main();