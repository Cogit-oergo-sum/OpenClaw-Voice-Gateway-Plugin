/**
 * 验证 mode_switch 工具是否会被触发
 * 模拟超过20轮对话场景
 */
import OpenAI from 'openai';

const API_KEY = 'sk-1aabae3cce604ddb82b78e315363beb2';
const BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = 'qwen3.6-flash';

// 模拟 ice_break 阶段的 System Prompt (简化版)
const SYSTEM_PROMPT = `你是桃子，迎新助手。

# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
- ice_break: 阶段一-破冰阶段：消除用户防备心理，建立轻松友好的沟通氛围
- phase_2_cooling: 阶段二-深度闲聊与冷却池：倾听陪伴，严禁推销，基于用户兴趣下钻
- phase_3_conversion: 阶段三-功能引导与判定出口：根据用户性格抛出沉浸式诱饵，执行转化指令
- end_session: 会话结束阶段：完成转化引导，下发客户端指令，优雅结束迎新流程

## 切换规则（必须遵守）
- 当用户话题需要切换模式时，你**必须**调用mode_switch工具。
- 切换时可以同时输出简短的过渡语（如"好的，换个话题~"）。
- 不能只在文本中说"切换模式"，必须调用工具才能实际切换。

# 当前阶段：ice_break（破冰阶段）
当前目标：消除用户防备心理，建立轻松友好的沟通氛围。

## 切换条件
**当聊了 20 个回合之后，用户的话语开始变长（不再只是单字敷衍），或者主动向你提问，表现出初步的信任后：**

**动作**：在回复文本中以"哎呀一直打字太累啦"或"跟你聊天挺投缘的"为理由，向用户发出【邀请上麦】的口语请求。

**调用 mode_switch 工具**：
target_mode: "phase_2_cooling"
`;

// 模拟超过20轮的对话历史（用户开始主动提问，表现出信任）
const messages: any[] = [
  { role: 'system', content: SYSTEM_PROMPT },
  // 模拟 20+ 轮对话历史（从日志中提取典型对话）
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
  // 关键转折：用户主动提问，表现信任感
  { role: 'user', content: '对了，这个APP有什么好玩的吗？你玩多久了？' }
];

// mode_switch 工具 schema
const modeSwitchSchema = {
  type: 'function' as const,
  function: {
    name: 'mode_switch',
    description: '切换对话模式/场景。根据用户话题变化或当前模式目标达成情况，切换到合适的模式。',
    parameters: {
      type: 'object',
      properties: {
        target_mode: {
          type: 'string',
          enum: ['ice_break', 'phase_2_cooling', 'phase_3_conversion', 'end_session'],
          description: '要切换到的目标模式'
        },
        context: {
          type: 'object',
          description: '切换时可携带的上下文信息'
        }
      },
      required: ['target_mode']
    }
  }
};

async function verify() {
  console.log('🚀 验证 mode_switch 工具触发...\n');
  console.log(`对话轮数: ${messages.length - 1} (超过20轮)`);
  console.log(`最后用户输入: "${messages[messages.length - 1].content}" (主动提问，表现信任)`);
  console.log('');

  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

  try {
    const stream = await client.chat.completions.create({
      model: MODEL,
      messages,
      tools: [modeSwitchSchema],
      stream: true,
      max_tokens: 150,
      temperature: 0.8
    });

    let fullText = '';
    // 累积 tool_calls 信息（流式增量）
    let toolCallAccumulator: { id?: string; name?: string; arguments?: string } | null = null;

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullText += content;
        process.stdout.write(content);
      }

      // 流式累积 tool_calls
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

    console.log('\n\n========================================');
    console.log(`📊 结果分析:`);

    if (toolCallAccumulator && toolCallAccumulator.name) {
      console.log(`✅ 工具被触发: ${toolCallAccumulator.name}`);
      if (toolCallAccumulator.arguments) {
        try {
          const args = JSON.parse(toolCallAccumulator.arguments);
          console.log(`   target_mode: ${args.target_mode}`);
          console.log(`   context: ${JSON.stringify(args.context || {})}`);
        } catch (e) {
          console.log(`   arguments (raw): ${toolCallAccumulator.arguments}`);
        }
      }
    } else {
      console.log(`❌ 工具未被触发`);
      console.log(`   模型输出: "${fullText.substring(0, 100)}..."`);
    }
    console.log('========================================\n');

    if (toolCallAccumulator && toolCallAccumulator.name === 'mode_switch') {
      console.log('✅ mode_switch 工具触发成功！');
      process.exit(0);
    } else if (toolCallAccumulator) {
      console.log(`⚠️ 其他工具被触发: ${toolCallAccumulator.name || 'unknown'}`);
      console.log('❌ 需要检查提示词是否正确引导模型调用 mode_switch');
      process.exit(1);
    } else {
      console.log('❌ 无工具触发，需要排查提示词或模型能力');
      process.exit(1);
    }

  } catch (e: any) {
    console.error('\n❌ 请求失败:', e.message);
    process.exit(1);
  }
}

verify();