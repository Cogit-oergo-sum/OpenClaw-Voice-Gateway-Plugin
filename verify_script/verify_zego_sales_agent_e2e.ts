/**
 * 端到端验证：ZEGO 官网售前获客 AI 架构师
 * 验证项：
 *   1. ModeManager 加载 5 个 mode 并正确解析 frontmatter
 *   2. SkillRegistry 加载 zego_doc_query 技能
 *   3. mode_switch 工具在 LLM 对话中被正确触发（discovery → solution）
 *   4. ZEGO MCP 端点连通性
 */
import { ModeManager } from '../src/agent/mode-manager';
import { SkillRegistry } from '../src/agent/skills';
import OpenAI from 'openai';
import * as fs from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';

const WORKSPACE = path.resolve(__dirname, '../../openclaw-test-env/workspace_standalone_zegoAIAssistant');
const API_KEY = process.env.BAILIAN_API_KEY || 'sk-1aabae3cce604ddb82b78e315363beb2';
const BASE_URL = process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
const MODEL = process.env.SLC_MODEL || 'qwen3.6-flash';

let passCount = 0;
let failCount = 0;

function pass(msg: string) { console.log(`  ✅ ${msg}`); passCount++; }
function fail(msg: string) { console.log(`  ❌ ${msg}`); failCount++; }
function warn(msg: string) { console.log(`  ⚠️  ${msg}`); }

// ──────────────────────────────────────────────
// Part 1: ModeManager 加载验证
// ──────────────────────────────────────────────
async function verifyModeManager() {
  console.log('\n━━━ Part 1: ModeManager 加载验证 ━━━');

  const manager = new ModeManager(WORKSPACE);
  await manager.loadFromDirectory();

  // 1.1 检查加载的模式数量
  const modeNames = manager.getModeNames();
  console.log(`  加载的模式: ${modeNames.join(', ')}`);
  if (modeNames.length === 5) pass('加载了 5 个模式');
  else fail(`期望 5 个模式，实际 ${modeNames.length} 个`);

  // 1.2 检查初始模式
  const initialMode = manager.getInitialMode();
  if (initialMode === 'discovery') pass(`初始模式为 discovery`);
  else fail(`初始模式期望 discovery，实际 ${initialMode}`);

  // 1.3 检查每个 mode 的 prompt 非空
  const expectedModes = ['discovery', 'solution', 'integration_guide', 'conversion', 'end_session'];
  for (const m of expectedModes) {
    const prompt = manager.getModePrompt(m);
    if (prompt && prompt.length > 50) pass(`mode "${m}" prompt 非空 (${prompt.length} chars)`);
    else fail(`mode "${m}" prompt 为空或过短`);
  }

  // 1.4 检查 mode_switch schema
  const schema = manager.getModeSwitchSchema();
  if (!schema) { fail('getModeSwitchSchema 返回 null'); return; }
  if (schema.function.name === 'mode_switch') pass('schema function name = mode_switch');
  else fail(`schema function name = ${schema.function.name}`);

  const enumValues: string[] = schema.function.parameters.properties.target_mode.enum;
  const allModesInEnum = expectedModes.every(m => enumValues.includes(m));
  if (allModesInEnum) pass('schema enum 包含所有 5 个 mode');
  else fail(`schema enum 缺少 mode: ${expectedModes.filter(m => !enumValues.includes(m)).join(', ')}`);

  // 1.5 检查 handleModeSwitch
  const result = manager.handleModeSwitch({ target_mode: 'solution', context: { reasoning: 'test' } });
  if (result.new_mode === 'solution') pass('handleModeSwitch discovery→solution 正确');
  else fail(`handleModeSwitch 返回 ${result.new_mode}`);

  // 1.6 检查切换到不存在的 mode
  const invalidResult = manager.handleModeSwitch({ target_mode: 'nonexistent' });
  if (invalidResult.new_mode === 'discovery') pass('handleModeSwitch 无效 mode 回退到初始模式');
  else warn(`无效 mode 回退到 ${invalidResult.new_mode}（非初始模式但不崩溃）`);
}

// ──────────────────────────────────────────────
// Part 2: SkillRegistry 加载验证
// ──────────────────────────────────────────────
async function verifySkillRegistry() {
  console.log('\n━━━ Part 2: SkillRegistry 加载验证 ━━━');

  const registry = SkillRegistry.getInstance();
  const skillsRepoDir = path.join(WORKSPACE, 'skills_repo');

  if (!fs.existsSync(skillsRepoDir)) { fail('skills_repo 目录不存在'); return; }

  await registry.loadFromDirectory(skillsRepoDir);

  // 2.1 检查 zego_doc_query 技能是否注册
  if (registry.hasSkill('zego_doc_query')) pass('zego_doc_query 技能已注册');
  else fail('zego_doc_query 技能未注册');

  // 2.2 检查技能参数
  const skill = registry.getSkill('zego_doc_query');
  if (!skill) { fail('无法获取 zego_doc_query 技能实例'); return; }

  if (skill.description && skill.description.includes('ZEGO')) pass('技能描述包含 ZEGO');
  else fail(`技能描述异常: ${skill.description}`);

  if (skill.parameters && skill.parameters.properties && skill.parameters.properties.action) {
    const actionEnum = skill.parameters.properties.action.enum;
    if (actionEnum && actionEnum.length === 6) pass(`action enum 有 6 个值: ${actionEnum.join(', ')}`);
    else fail(`action enum 异常: ${JSON.stringify(actionEnum)}`);
  } else {
    fail('parameters.action 不存在');
  }

  // 2.3 检查 SKILL.md frontmatter 解析
  const skillMdPath = path.join(skillsRepoDir, 'zego-doc-query', 'SKILL.md');
  if (fs.existsSync(skillMdPath)) {
    const content = fs.readFileSync(skillMdPath, 'utf8');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    if (fmMatch) {
      const fm: any = yaml.load(fmMatch[1]);
      if (fm.runtime === 'mcp') pass('runtime = mcp');
      else fail(`runtime = ${fm.runtime}`);
      if (fm.endpoint && fm.endpoint.includes('zego.im')) pass(`endpoint 包含 zego.im: ${fm.endpoint}`);
      else fail(`endpoint 异常: ${fm.endpoint}`);
    } else {
      fail('SKILL.md frontmatter 解析失败');
    }
  } else {
    fail('SKILL.md 文件不存在');
  }
}

// ──────────────────────────────────────────────
// Part 3: mode_switch LLM 触发验证
// ──────────────────────────────────────────────
async function verifyModeSwitchLLM() {
  console.log('\n━━━ Part 3: mode_switch LLM 触发验证 ━━━');

  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

  // 加载 discovery mode 的完整 prompt
  const manager = new ModeManager(WORKSPACE);
  await manager.loadFromDirectory();
  const discoveryPrompt = manager.getModePrompt('discovery');

  // 构造 System Prompt
  const systemPrompt = `你是 ZEGO AI 架构师，即构科技的官网售前技术顾问。

# 模式切换能力
你拥有切换对话模式的能力。当前可用的模式有：
${manager.getModeDescriptions()}

## 切换规则（必须遵守）
- 当用户话题需要切换模式时，你**必须**调用mode_switch工具。
- 切换时可以同时输出简短的过渡语。
- 不能只在文本中说"切换模式"，必须调用工具才能实际切换。

# 语音输出规范
- 严禁Markdown格式
- 输出总长度在60字以内，首句4～10个字
- 结尾需要主动询问一个问题

${discoveryPrompt}`;

  const modeSwitchSchema = manager.getModeSwitchSchema()!;

  // Test Case: 用户说出明确业务场景，应触发 discovery → solution
  const testCases = [
    {
      name: 'discovery→solution (明确场景)',
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: '你好' },
        { role: 'assistant' as const, content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？' },
        { role: 'user' as const, content: '我们公司做语聊房的，想找语音方案' },
      ],
      expectSwitch: 'solution'
    },
    {
      name: 'discovery→solution (多轮后识别)',
      messages: [
        { role: 'system' as const, content: systemPrompt },
        { role: 'user' as const, content: '你好' },
        { role: 'assistant' as const, content: '您好，我是ZEGO AI架构师，请问您目前在看哪块技术方案？' },
        { role: 'user' as const, content: '我在看你们的方案' },
        { role: 'assistant' as const, content: '好的，您是做什么业务的呀？' },
        { role: 'user' as const, content: '在线教育，想做小班课' },
      ],
      expectSwitch: 'solution'
    },
  ];

  for (const tc of testCases) {
    console.log(`\n  测试: ${tc.name}`);

    try {
      const stream = await client.chat.completions.create({
        model: MODEL,
        messages: tc.messages as any,
        tools: [modeSwitchSchema as any],
        stream: true,
        max_tokens: 150,
        temperature: 0.7
      });

      let outputText = '';
      let toolCallAccumulator: { id?: string; name?: string; arguments?: string } | null = null;

      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) outputText += content;

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

      if (toolCallAccumulator && toolCallAccumulator.name === 'mode_switch') {
        const args = JSON.parse(toolCallAccumulator.arguments || '{}');
        if (args.target_mode === tc.expectSwitch) {
          pass(`${tc.name}: 正确切换到 ${args.target_mode}`);
        } else {
          fail(`${tc.name}: 切换到 ${args.target_mode}，期望 ${tc.expectSwitch}`);
        }
        console.log(`    回复: "${outputText.substring(0, 80)}..."`);
      } else if (toolCallAccumulator) {
        fail(`${tc.name}: 触发了其他工具 ${toolCallAccumulator.name}`);
      } else {
        fail(`${tc.name}: 未触发 mode_switch，回复: "${outputText.substring(0, 80)}..."`);
      }
    } catch (e: any) {
      fail(`${tc.name}: 请求失败 - ${e.message}`);
    }
  }
}

// ──────────────────────────────────────────────
// Part 4: ZEGO MCP 端点连通性
// ──────────────────────────────────────────────
async function verifyMCPEndpoint() {
  console.log('\n━━━ Part 4: ZEGO MCP 端点连通性 ━━━');

  const https = await import('https');

  const checkUrl = (url: string): Promise<{ status: number; reachable: boolean }> => {
    return new Promise((resolve) => {
      const req = https.get(url, { timeout: 5000 }, (res) => {
        resolve({ status: res.statusCode || 0, reachable: true });
      });
      req.on('error', () => resolve({ status: 0, reachable: false }));
      req.on('timeout', () => { req.destroy(); resolve({ status: 0, reachable: false }); });
    });
  };

  // 4.1 检查 MCP 端点
  const mcpResult = await checkUrl('https://doc-ai.zego.im/mcp/');
  if (mcpResult.reachable) {
    pass(`MCP 端点可达 (HTTP ${mcpResult.status})`);
    if (mcpResult.status === 406) {
      pass('HTTP 406 = MCP 协议要求 POST/SSE，GET 被拒是正常的');
    }
  } else {
    fail('MCP 端点不可达');
  }

  // 4.2 检查 ZEGO 文档中心
  const docResult = await checkUrl('https://doc-zh.zego.im/');
  if (docResult.reachable) {
    pass(`ZEGO 文档中心可达 (HTTP ${docResult.status})`);
  } else {
    warn('ZEGO 文档中心不可达（可能需要VPN）');
  }
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
async function main() {
  console.log('🚀 ZEGO 官网售前获客 AI 架构师 — 端到端验证');
  console.log(`Workspace: ${WORKSPACE}`);
  console.log(`Model: ${MODEL}, BaseURL: ${BASE_URL}`);

  if (!fs.existsSync(WORKSPACE)) {
    console.error(`❌ Workspace 目录不存在: ${WORKSPACE}`);
    process.exit(1);
  }

  await verifyModeManager();
  await verifySkillRegistry();
  await verifyModeSwitchLLM();
  await verifyMCPEndpoint();

  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`📊 总计: ${passCount + failCount} 项, ✅ ${passCount} 通过, ❌ ${failCount} 失败`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (failCount === 0) {
    console.log('✅ ALL TESTS PASSED!');
    process.exit(0);
  } else {
    console.log('❌ SOME TESTS FAILED');
    process.exit(1);
  }
}

main().catch(e => {
  console.error('\n❌ VERIFICATION FAILED:');
  console.error(e);
  process.exit(1);
});
