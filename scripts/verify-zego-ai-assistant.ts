/**
 * zegoAI Assistant 模拟验证对话脚本
 * 通过预定义问题请求 agent，捕获响应并自动断言验证，输出结构化 TXT 报告。
 *
 * 用法:
 *   ts-node --transpile-only scripts/verify-zego-ai-assistant.ts
 *   ts-node --transpile-only scripts/verify-zego-ai-assistant.ts --group zego_intro
 *   ts-node --transpile-only scripts/verify-zego-ai-assistant.ts --only intro_greeting
 */

import { FastAgentV3 as FastAgent } from '../src/agent/fast-agent-v3';
import { FastAgentResponse } from '../src/agent/types';
import { callContextStorage } from '../src/context/ctx';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

dotenv.config();

// ======================== Types ========================

type AssertionType =
  | 'contains' | 'not_contains' | 'contains_any'
  | 'no_action' | 'action_present' | 'no_duplicate_action' | 'max_one_action_per_turn'
  | 'no_tool_call' | 'tool_called' | 'tool_result_returned'
  | 'mode_is' | 'mode_changed' | 'mode_not_changed'
  | 'response_length_gt' | 'response_length_lt' | 'no_empty_func_tag' | 'no_redundant_mode_switch' | 'custom';

interface Assertion {
  type: AssertionType;
  value?: string | string[] | number;
  description: string;
  severity: 'critical' | 'soft';
  /** Custom predicate for 'custom' type */
  predicate?: (captured: CapturedResponse) => { passed: boolean; actual: string };
}

interface Turn {
  userMessage: string;
  assertions: Assertion[];
  delayBeforeMs?: number;
}

type SessionMode = 'fresh' | 'chained' | 'warm';

interface VerificationScenario {
  id: string;
  group: string;
  description: string;
  sessionMode: SessionMode;
  warmupTurns?: Turn[];
  warmupTargetMode?: string;
  turns: Turn[];
}

interface LatencyMetrics {
  totalMs: number;
  ttftMs: number | null;
  firstSentenceMs: number | null;
  modules: {
    routerMs: number | null;
    slcMs: number | null;
    sleMs: number | null;
    toolMs: number | null;
    summarizeMs: number | null;
  };
}

const EMPTY_LATENCY: LatencyMetrics = {
  totalMs: 0, ttftMs: null, firstSentenceMs: null,
  modules: { routerMs: null, slcMs: null, sleMs: null, toolMs: null, summarizeMs: null }
};

interface CapturedResponse {
  fullText: string;
  actions: string[];
  toolCalls: string[];
  toolResultReceived: boolean;
  toolResultLatencyMs: number | null;
  modeChanged: boolean;
  newMode?: string;
  previousMode?: string;
  chunkTypes: string[];
  latency: LatencyMetrics;
}

interface AssertionResult {
  assertion: Assertion;
  passed: boolean;
  actual: string;
}

interface TurnResult {
  turnIndex: number;
  userMessage: string;
  captured: CapturedResponse;
  assertionResults: AssertionResult[];
  allCriticalPassed: boolean;
}

interface ScenarioResult {
  scenarioId: string;
  scenarioGroup: string;
  description: string;
  turnResults: TurnResult[];
  overallCriticalPassed: boolean;
  startTime: number;
  endTime: number;
}

// ======================== Custom Predicates ========================

const PRICING_FABRICATION_REGEX = /(?:¥|￥)\s*\d|[\d,]+\s*元[/月年]|每月\s*[\d,]+|单价\s*[\d,]+|\d+\s*块/;
const COMPETITOR_CLAIM_REGEX = /(?:比|对比|对比|胜过|优于|强于|好于|不如|差于|弱于).*(?:声网|Agora|融云|腾讯|TRTC|即信|容联|网易云信)/;

function noFabricatedPricing(captured: CapturedResponse): { passed: boolean; actual: string } {
  const hasFabricated = PRICING_FABRICATION_REGEX.test(captured.fullText);
  return { passed: !hasFabricated, actual: hasFabricated ? 'FOUND fabricated pricing' : 'No fabricated pricing' };
}

function noCompetitorClaim(captured: CapturedResponse): { passed: boolean; actual: string } {
  const hasClaim = COMPETITOR_CLAIM_REGEX.test(captured.fullText);
  return { passed: !hasClaim, actual: hasClaim ? 'FOUND competitor claim' : 'No competitor claim' };
}

// ======================== Assertion Evaluation ========================

function evaluateAssertions(
  captured: CapturedResponse,
  assertions: Assertion[],
  previousActions: string[]  // for no_duplicate_action
): AssertionResult[] {
  return assertions.map(assertion => {
    let passed = false;
    let actual = '';

    switch (assertion.type) {
      case 'contains':
        passed = captured.fullText.includes(assertion.value as string);
        actual = `contains "${assertion.value}": ${passed}`;
        break;

      case 'not_contains':
        passed = !captured.fullText.includes(assertion.value as string);
        actual = `not contains "${assertion.value}": ${passed}`;
        break;

      case 'contains_any': {
        const keywords = assertion.value as string[];
        const found = keywords.find(k => captured.fullText.includes(k));
        passed = !!found;
        actual = `found "${found || 'none'}" in [${keywords.join(', ')}]`;
        break;
      }

      case 'no_action':
        passed = captured.actions.length === 0;
        actual = `actions: [${captured.actions.join(', ')}]`;
        break;

      case 'action_present': {
        const prefix = assertion.value as string;
        passed = captured.actions.some(a => a.startsWith(prefix) || a === prefix);
        actual = `actions: [${captured.actions.join(', ')}], looking for "${prefix}"`;
        break;
      }

      case 'no_duplicate_action': {
        if (previousActions.length === 0) {
          passed = true;
          actual = 'no previous turn to compare';
        } else {
          const hasDup = captured.actions.some(a => previousActions.includes(a));
          passed = !hasDup;
          actual = hasDup
            ? `DUPLICATE: current [${captured.actions.join(', ')}] vs previous [${previousActions.join(', ')}]`
            : `no duplicate (current: [${captured.actions.join(', ')}], prev: [${previousActions.join(', ')}])`;
        }
        break;
      }

      case 'max_one_action_per_turn':
        passed = captured.actions.length <= 1;
        actual = `actions count: ${captured.actions.length} (max 1)`;
        break;

      case 'no_tool_call':
        passed = captured.toolCalls.length === 0 && !captured.toolResultReceived;
        actual = `toolCalls: [${captured.toolCalls.join(', ')}], toolResultReceived: ${captured.toolResultReceived}`;
        break;

      case 'tool_called': {
        const toolName = assertion.value as string;
        passed = captured.toolCalls.includes(toolName) || captured.toolResultReceived;
        actual = `toolCalls: [${captured.toolCalls.join(', ')}], toolResultReceived: ${captured.toolResultReceived}`;
        break;
      }

      case 'tool_result_returned':
        passed = captured.toolResultReceived;
        actual = `toolResultReceived: ${captured.toolResultReceived}`;
        break;

      case 'mode_is': {
        const expected = assertion.value as string;
        const current = captured.newMode || captured.previousMode;
        passed = current === expected;
        actual = `current mode: ${current || 'unknown'}, expected: ${expected}`;
        break;
      }

      case 'mode_changed':
        passed = captured.modeChanged;
        actual = `modeChanged: ${captured.modeChanged}${captured.newMode ? ` (to ${captured.newMode})` : ''}`;
        break;

      case 'mode_not_changed':
        passed = !captured.modeChanged;
        actual = `modeChanged: ${captured.modeChanged}`;
        break;

      case 'response_length_gt':
        passed = captured.fullText.length > (assertion.value as number);
        actual = `length: ${captured.fullText.length} > ${assertion.value}`;
        break;

      case 'response_length_lt':
        passed = captured.fullText.length < (assertion.value as number);
        actual = `length: ${captured.fullText.length} < ${assertion.value}`;
        break;

      case 'no_empty_func_tag': {
        const emptyFuncMatch = captured.fullText.match(/\[FUNC:\s*\]/);
        passed = !emptyFuncMatch;
        actual = emptyFuncMatch ? `found empty FUNC tag: ${emptyFuncMatch[0]}` : 'no empty FUNC tags';
        break;
      }

      case 'no_redundant_mode_switch': {
        // Check if FUNC tag switches to current mode
        const funcSwitchMatch = captured.fullText.match(/\[FUNC\s*:\s*mode_switch[(:\|][^\]]]*target_mode[=:\s]*(\w+)/);
        if (funcSwitchMatch && captured.previousMode) {
          passed = funcSwitchMatch[1] !== captured.previousMode;
          actual = passed
            ? `target_mode=${funcSwitchMatch[1]} != current=${captured.previousMode}`
            : `REDUNDANT: target_mode=${funcSwitchMatch[1]} == current=${captured.previousMode}`;
        } else {
          passed = true;
          actual = 'no redundant mode_switch detected';
        }
        break;
      }

      case 'custom': {
        if (assertion.predicate) {
          const result = assertion.predicate(captured);
          passed = result.passed;
          actual = result.actual;
        } else {
          passed = false;
          actual = 'no custom predicate provided';
        }
        break;
      }
    }

    return { assertion, passed, actual };
  });
}

// ======================== Global ACTION Assertions ========================

/** Auto-attach ACTION protocol + FUNC protocol assertions to every turn */
function withGlobalAssertions(assertions: Assertion[]): Assertion[] {
  const hasNoDup = assertions.some(a => a.type === 'no_duplicate_action');
  const hasMaxOne = assertions.some(a => a.type === 'max_one_action_per_turn');
  const hasNoEmptyFunc = assertions.some(a => a.type === 'no_empty_func_tag');
  const hasNoRedundant = assertions.some(a => a.type === 'no_redundant_mode_switch');
  const hasMinLength = assertions.some(a => a.type === 'response_length_gt');
  const global: Assertion[] = [];
  if (!hasNoDup) global.push({ type: 'no_duplicate_action', description: 'No duplicate ACTION across turns', severity: 'critical' });
  if (!hasMaxOne) global.push({ type: 'max_one_action_per_turn', description: 'Max 1 ACTION per turn', severity: 'critical' });
  if (!hasNoEmptyFunc) global.push({ type: 'no_empty_func_tag', description: 'No empty FUNC tag [FUNC: ]', severity: 'critical' });
  if (!hasNoRedundant) global.push({ type: 'no_redundant_mode_switch', description: 'No redundant mode_switch to current mode', severity: 'critical' });
  if (!hasMinLength) global.push({ type: 'response_length_gt', value: 10, description: 'Response not empty (length > 10)', severity: 'critical' });
  return [...assertions, ...global];
}

// ======================== sendTurn ========================

async function sendTurn(
  agent: FastAgent,
  userMessage: string,
  callId: string
): Promise<CapturedResponse> {
  const captured: CapturedResponse = {
    fullText: '',
    actions: [],
    toolCalls: [],
    toolResultReceived: false,
    toolResultLatencyMs: null,
    modeChanged: false,
    newMode: undefined,
    previousMode: undefined,
    chunkTypes: [],
    latency: { ...EMPTY_LATENCY },
  };

  await callContextStorage.run(
    { callId, userId: 'verify-user', startTime: Date.now(), metadata: {} },
    async () => {
      await agent.process(userMessage, (chunk: FastAgentResponse) => {
        captured.chunkTypes.push(chunk.type);

        if (chunk.content) {
          // Skip thought-type chunks (internal shadow thought injection, not user-visible output)
          if (chunk.type !== 'thought') {
            captured.fullText += chunk.content;
          }
        }

        // Track mode changes via mode_update chunk
        if (chunk.type === 'mode_update' && chunk.mode) {
          captured.modeChanged = true;
          captured.newMode = chunk.mode;
        }
        // Track current mode from any chunk's mode field (SLC injects mode in chat chunks)
        if (chunk.mode && chunk.type !== 'mode_update') {
          if (!captured.previousMode) {
            captured.previousMode = chunk.mode;
          }
          // If mode differs from previous, it changed within this turn
          if (captured.previousMode && chunk.mode !== captured.previousMode) {
            captured.modeChanged = true;
            captured.newMode = chunk.mode;
          }
        }

        // Track tool calls
        if (chunk.type === 'tool_result') {
          captured.toolResultReceived = true;
        }

        // Track tool names from trace
        if (chunk.trace) {
          for (const entry of chunk.trace) {
            const m = entry.match(/TOOL_EXEC\((\w+)\)/);
            if (m && !captured.toolCalls.includes(m[1])) {
              captured.toolCalls.push(m[1]);
            }
          }
        }

        // Extract latency from isFinal chunk
        if (chunk.isFinal && chunk.perf) {
          const p = chunk.perf;
          captured.latency = {
            totalMs: p.total || 0,
            ttftMs: p.ttft ?? null,
            firstSentenceMs: p.first_sentence ?? null,
            modules: {
              routerMs: p.modules?.router ?? null,
              slcMs: p.modules?.slc ?? null,
              sleMs: p.modules?.sle ?? null,
              toolMs: p.modules?.tool ?? null,
              summarizeMs: p.modules?.summarize ?? null,
            }
          };
          if (p.modules?.tool) {
            captured.toolResultLatencyMs = p.modules.tool;
          }
        }
      }, async (_text: string) => {
        // async notifications - ignore
      });
    }
  );

  // Post-process: extract ACTION tags
  const actionRegex = /\[ACTION\s*:\s*([^\]]+)\]/gi;
  let match;
  while ((match = actionRegex.exec(captured.fullText)) !== null) {
    captured.actions.push(match[1]);
  }

  // [ARCH] Post-process: extract FUNC tags as toolCalls (for no_tool_call / tool_called assertion compatibility)
  const funcTagRegex = /\[FUNC\s*:\s*(\w+)[(\|:]/g;
  let funcMatch;
  while ((funcMatch = funcTagRegex.exec(captured.fullText)) !== null) {
    captured.toolCalls.push(funcMatch[1]);
  }

  // Post-process: detect text-form mode_switch (when SLC outputs [ACTION:mode_switch] instead of tool_call)
  // Also detect [FUNC:mode_switch(...)] for func_tags architecture variant
  if (!captured.modeChanged) {
    const actionModeSwitchMatch = captured.fullText.match(/\[ACTION\s*:\s*mode_switch\]/i);
    const funcModeSwitchMatch = captured.fullText.match(/\[FUNC\s*:\s*mode_switch[(:\|]/);
    if (actionModeSwitchMatch || funcModeSwitchMatch) {
      captured.modeChanged = true;
      // Try to extract target_mode from FUNC tag arguments
      const funcTargetMatch = captured.fullText.match(/\[FUNC\s*:\s*mode_switch[(:\|][^\]]*target_mode[=:\s]*(\w+)/);
      if (funcTargetMatch) {
        captured.newMode = funcTargetMatch[1];
      } else {
        // Try to detect target mode from follow-up text patterns or chunk.mode fields
        const modePatterns: [string, RegExp][] = [
          ['discovery', /discovery|探寻|业务/],
          ['solution', /solution|方案|推荐/],
          ['integration_guide', /integration|接入|文档/],
          ['conversion', /conversion|留资|试用/],
          ['end_session', /end_session|结束|再见/],
        ];
        for (const [mode, regex] of modePatterns) {
          if (regex.test(captured.fullText)) {
            captured.newMode = mode;
            break;
          }
        }
      }
    }
  }

  // If modeChanged was detected but newMode is still undefined, try extracting from ACTION tag arguments
  if (captured.modeChanged && !captured.newMode) {
    // Check for [ACTION:mode_switch,target_mode] or mode field in non-mode_update chunks
    const actionModeMatch = captured.fullText.match(/\[ACTION\s*:\s*mode_switch[,\s]*(\w+)\]/i);
    if (actionModeMatch) {
      captured.newMode = actionModeMatch[1];
    }
    // Also check if any non-mode_update chunk had a mode field (SLC injects mode in follow-up chunks)
    // This was already handled in the chunk callback loop above
  }

  // Fallback: read current mode from ShadowState on disk (for cases where mode_update chunk was missed)
  if (!captured.newMode) {
    try {
      const shadowPath = path.join(
        process.env.VOICE_GATEWAY_WORKSPACE || path.join(__dirname, '..', '..', 'openclaw-test-env', 'workspace_standalone_zegoAIAssistant'),
        'states', `${callId}.wal`
      );
      if (fs.existsSync(shadowPath)) {
        const raw = fs.readFileSync(shadowPath, 'utf-8');
        const state = JSON.parse(raw);
        if (state?.metadata?.current_mode) {
          if (!captured.previousMode) captured.previousMode = state.metadata.current_mode;
          if (captured.modeChanged) captured.newMode = state.metadata.current_mode;
        }
      }
    } catch {
      // ShadowState read failed, ignore
    }
  }

  return captured;
}

// ======================== Scenario Definitions ========================

const ALL_SCENARIOS: VerificationScenario[] = [
  // ---- A. General / Universal ----
  {
    id: 'general_offtopic_weather', group: 'general',
    description: 'Off-topic: weather → deflect back to ZEGO',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '今天天气怎么样',
      assertions: [
        { type: 'contains_any', value: ['ZEGO', '即构', '音视频', '实时互动', '方案', '产品'], description: 'Deflects back to ZEGO topic', severity: 'critical' },
        { type: 'not_contains', value: '度', description: 'Does not answer weather', severity: 'critical' },
        { type: 'no_tool_call', description: 'No tool for off-topic', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'general_offtopic_sports', group: 'general',
    description: 'Off-topic: sports → deflect back to ZEGO',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '昨晚世界杯谁赢了',
      assertions: [
        { type: 'contains_any', value: ['ZEGO', '即构', '音视频', '方案', '产品'], description: 'Deflects back to ZEGO', severity: 'critical' },
        { type: 'no_tool_call', description: 'No tool for off-topic', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'general_offtopic_politics', group: 'general',
    description: 'Off-topic: politics → deflect back to ZEGO',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你对最近的政策调整怎么看',
      assertions: [
        { type: 'contains_any', value: ['ZEGO', '即构', '音视频', '方案', '产品'], description: 'Deflects back to ZEGO', severity: 'critical' },
        { type: 'no_tool_call', description: 'No tool for off-topic', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'general_wrong_skill', group: 'general',
    description: 'General chat should not trigger tool call',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你们公司叫什么来着',
      assertions: [
        { type: 'no_tool_call', description: 'No tool for simple question', severity: 'critical' },
        { type: 'contains_any', value: ['ZEGO', '即构'], description: 'Answers about ZEGO', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'general_redline_pricing', group: 'general',
    description: 'Pricing red line: no fabricated numbers',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你们的RTC多少钱一个月',
      assertions: [
        { type: 'custom', description: 'No fabricated pricing numbers', severity: 'critical', predicate: noFabricatedPricing },
        { type: 'contains_any', value: ['确认', '商务', '报价', '联系'], description: 'Redirects to business', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'general_no_privacy', group: 'general',
    description: 'Should not ask for privacy info',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你好，我想了解一下你们的产品',
      assertions: [
        { type: 'not_contains', value: '身份证', description: 'No ID card request', severity: 'critical' },
        { type: 'not_contains', value: '手机号', description: 'No phone request', severity: 'critical' },
        { type: 'not_contains', value: '银行卡', description: 'No bank card request', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'general_no_competitor_fabrication', group: 'general',
    description: 'Competitor comparison: no fabricated conclusions',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你们和声网比哪个好',
      assertions: [
        { type: 'custom', description: 'No fabricated competitor claim', severity: 'critical', predicate: noCompetitorClaim },
        { type: 'contains_any', value: ['ZEGO', '优势', '帮您', '确认'], description: 'Redirects to ZEGO strengths', severity: 'soft' },
      ]
    }]
  },

  // ---- B. zego_intro ----
  {
    id: 'intro_greeting', group: 'zego_intro',
    description: 'First greeting: no skill call, direct SLC response',
    sessionMode: 'fresh',
    turns: [{
      userMessage: '你好',
      assertions: [
        { type: 'no_tool_call', description: 'No skill/tool on greeting', severity: 'critical' },
        { type: 'contains_any', value: ['ZEGO', '即构', '了解'], description: 'Mentions ZEGO', severity: 'soft' },
        { type: 'mode_not_changed', description: 'Stays in zego_intro', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'intro_stranger', group: 'zego_intro',
    description: '"没听过ZEGO" → company positioning intro',
    sessionMode: 'fresh',
    turns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [
        { type: 'contains_any', value: ['2015', '实时', '音视频', '互动', 'RTC', '即构'], description: 'Company positioning intro', severity: 'critical' },
        { type: 'no_action', description: 'No ACTION in basic intro', severity: 'soft' },
      ]}
    ]
  },
  {
    id: 'intro_partial_awareness', group: 'zego_intro',
    description: '"听过但不太熟" → product line overview',
    sessionMode: 'fresh',
    turns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '听过但不太熟', assertions: [
        { type: 'contains_any', value: ['音视频', '直播', 'IM', 'AI', '语音', '实时'], description: 'Product line overview', severity: 'critical' },
      ]}
    ]
  },
  {
    id: 'intro_quick_transition', group: 'zego_intro',
    description: '"了解了，我们做直播的" → mode_switch to discovery',
    sessionMode: 'fresh',
    turns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做直播的', assertions: [
        { type: 'mode_changed', description: 'Mode switches out of zego_intro', severity: 'critical' },
        { type: 'mode_is', value: 'discovery', description: 'Transitions to discovery', severity: 'critical' },
      ]}
    ]
  },
  {
    id: 'intro_vague_auto', group: 'zego_intro',
    description: '2x vague responses → auto-transition with fallback',
    sessionMode: 'fresh',
    turns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '嗯', assertions: [] },
      { userMessage: '随便看看', assertions: [
        { type: 'mode_changed', description: 'Auto-transitions after 2 vague responses', severity: 'critical' },
      ]}
    ]
  },

  // ---- C. Discovery ----
  {
    id: 'discovery_scenario_probe', group: 'discovery',
    description: '"我们做语聊房的" → asks client_type',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [] },
      { userMessage: '了解了，我们做语音互动的', assertions: [] },
    ],
    warmupTargetMode: 'discovery',
    turns: [{
      userMessage: '我们做语聊房的',
      assertions: [
        { type: 'contains_any', value: ['初创', '成熟', '企业', '调研', '项目', '方案', '已有'], description: 'Asks about client_type', severity: 'critical' },
        { type: 'mode_not_changed', description: 'Stays in discovery', severity: 'soft' },
        { type: 'tool_called', value: 'trigger_sle_check', description: 'Triggers SLE check for product inquiry', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'discovery_client_type_probe', group: 'discovery',
    description: '"我们是个初创" → asks scenario',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [] },
      { userMessage: '了解了，我们做语音互动的', assertions: [] },
    ],
    warmupTargetMode: 'discovery',
    turns: [{
      userMessage: '我们是个初创公司',
      assertions: [
        { type: 'contains_any', value: ['场景', '做什么', '业务', '语聊', '直播', '会议', '教育'], description: 'Asks about scenario', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'discovery_both_tags', group: 'discovery',
    description: 'Both tags collected → mode_switch to solution',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [] },
      { userMessage: '了解了，我们做语音互动的', assertions: [] },
    ],
    warmupTargetMode: 'discovery',
    turns: [
      { userMessage: '我们做语聊房的，是个成熟企业', assertions: [
        { type: 'mode_changed', description: 'Transitions to solution', severity: 'critical' },
        { type: 'mode_is', value: 'solution', description: 'Mode is solution', severity: 'critical' },
      ]}
    ]
  },
  {
    id: 'discovery_direct_product_ask', group: 'discovery',
    description: '"你们RTC怎么接入" → direct jump to solution',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [] },
      { userMessage: '了解了', assertions: [] },
    ],
    warmupTargetMode: 'discovery',
    turns: [{
      userMessage: '你们RTC怎么接入',
      assertions: [
        { type: 'mode_changed', description: 'Transitions out of discovery', severity: 'critical' },
        { type: 'mode_is', value: 'solution', description: 'Mode is solution', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'discovery_vague_hook', group: 'discovery',
    description: '2x vague → throws hook question',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '没听过ZEGO', assertions: [] },
      { userMessage: '了解了', assertions: [] },
    ],
    warmupTargetMode: 'discovery',
    turns: [
      { userMessage: '嗯', assertions: [] },
      { userMessage: '随便看看', assertions: [
        { type: 'contains_any', value: ['感兴趣', '哪块', '音视频', 'AI', '互动', 'IM'], description: 'Hook question', severity: 'critical' },
      ]}
    ]
  },

  // ---- D. Solution ----
  {
    id: 'solution_recommendation', group: 'solution',
    description: 'Recommend product → must trigger SHOW_PAGE',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
    ],
    warmupTargetMode: 'solution',
    turns: [{
      userMessage: '你们有什么推荐的方案',
      assertions: [
        { type: 'action_present', value: 'SHOW_PAGE:', description: 'Must trigger SHOW_PAGE', severity: 'critical' },
        { type: 'max_one_action_per_turn', description: 'Max 1 ACTION per turn', severity: 'critical' },
        { type: 'tool_called', value: 'trigger_sle_check', description: 'Triggers SLE check for solution recommendation', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'solution_pricing_redirect', group: 'solution',
    description: 'Pricing ask → redirect to integration_guide',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
    ],
    warmupTargetMode: 'solution',
    turns: [{
      userMessage: '你们怎么收费的',
      assertions: [
        { type: 'mode_changed', description: 'Transitions to integration_guide', severity: 'critical' },
        { type: 'mode_is', value: 'integration_guide', description: 'Mode is integration_guide', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'solution_max_two_products', group: 'solution',
    description: 'Multiple products → max 2 options',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做在线教育的', assertions: [] },
      { userMessage: '我们是个初创', assertions: [] },
    ],
    warmupTargetMode: 'solution',
    turns: [{
      userMessage: '推荐一下方案',
      assertions: [
        { type: 'action_present', value: 'SHOW_PAGE:', description: 'Triggers SHOW_PAGE', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'solution_premature_lead', group: 'solution',
    description: 'Premature: no POPUP_LEAD_FORM before conditions met',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个初创', assertions: [] },
    ],
    warmupTargetMode: 'solution',
    turns: [{
      userMessage: '方案看起来还行',
      assertions: [
        { type: 'not_contains', value: 'POPUP_LEAD_FORM', description: 'No premature lead form', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'solution_no_duplicate_action', group: 'solution',
    description: 'Consecutive recommendations: no duplicate ACTION',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
    ],
    warmupTargetMode: 'solution',
    turns: [
      { userMessage: '推荐一下方案', assertions: [] },
      { userMessage: '还有别的吗', assertions: [
        { type: 'no_duplicate_action', description: 'No duplicate ACTION across turns', severity: 'critical' },
      ]}
    ]
  },

  // ---- E. Integration Guide ----
  {
    id: 'ig_platforms_query', group: 'integration_guide',
    description: 'Ask platforms → call get_platforms_by_product',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '怎么接入', assertions: [] },
    ],
    warmupTargetMode: 'integration_guide',
    turns: [{
      userMessage: '你们的SDK支持哪些平台',
      assertions: [
        { type: 'tool_called', value: 'zego_doc_query', description: 'Calls zego_doc_query', severity: 'critical' },
        { type: 'tool_result_returned', description: 'Tool returned result', severity: 'critical' },
        { type: 'tool_called', value: 'trigger_sle_check', description: 'Triggers SLE check for platform query', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'ig_docs_query', group: 'integration_guide',
    description: 'Ask docs → call get_doc_links',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '怎么接入', assertions: [] },
    ],
    warmupTargetMode: 'integration_guide',
    turns: [{
      userMessage: '有没有接入文档',
      assertions: [
        { type: 'tool_called', value: 'zego_doc_query', description: 'Calls zego_doc_query', severity: 'critical' },
        { type: 'tool_result_returned', description: 'Tool returned result', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'ig_auth_query', group: 'integration_guide',
    description: 'Ask auth → call get_token_generate_doc',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '怎么接入', assertions: [] },
    ],
    warmupTargetMode: 'integration_guide',
    turns: [{
      userMessage: '鉴权怎么做',
      assertions: [
        { type: 'tool_called', value: 'zego_doc_query', description: 'Calls zego_doc_query', severity: 'critical' },
        { type: 'tool_result_returned', description: 'Tool returned result', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'ig_pricing_redirect', group: 'integration_guide',
    description: 'Pricing ask → redirect to business, no fabrication',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '怎么接入', assertions: [] },
    ],
    warmupTargetMode: 'integration_guide',
    turns: [{
      userMessage: '具体什么价格',
      assertions: [
        { type: 'contains_any', value: ['商务', '联系', '报价', '确认'], description: 'Redirects to business', severity: 'critical' },
        { type: 'custom', description: 'No fabricated pricing', severity: 'critical', predicate: noFabricatedPricing },
      ]
    }]
  },
  {
    id: 'ig_high_intent', group: 'integration_guide',
    description: '"想试试" → mode_switch to conversion',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '怎么接入', assertions: [] },
    ],
    warmupTargetMode: 'integration_guide',
    turns: [{
      userMessage: '想试试看',
      assertions: [
        { type: 'mode_changed', description: 'Transitions to conversion', severity: 'critical' },
        { type: 'mode_is', value: 'conversion', description: 'Mode is conversion', severity: 'critical' },
      ]
    }]
  },

  // ---- F. Conversion ----
  {
    id: 'conversion_agree', group: 'conversion',
    description: 'Agree to leave contact → trigger POPUP_LEAD_FORM',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
    ],
    warmupTargetMode: 'conversion',
    turns: [{
      userMessage: '好的，可以留个联系方式',
      assertions: [
        { type: 'action_present', value: 'POPUP_LEAD_FORM', description: 'Triggers lead form', severity: 'critical' },
      ]
    }]
  },
  {
    id: 'conversion_refuse', group: 'conversion',
    description: 'Refuse → no second push, graceful retreat',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
    ],
    warmupTargetMode: 'conversion',
    turns: [{
      userMessage: '不用了，我再看看',
      assertions: [
        { type: 'not_contains', value: 'POPUP_LEAD_FORM', description: 'No lead form after refusal', severity: 'critical' },
        { type: 'contains_any', value: ['没问题', '随时', '不着急', '慢慢'], description: 'Graceful retreat', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'conversion_more_questions', group: 'conversion',
    description: 'More questions → mode_switch to integration_guide',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
    ],
    warmupTargetMode: 'conversion',
    turns: [{
      userMessage: '我还有个技术问题想问一下',
      assertions: [
        { type: 'mode_changed', description: 'Transitions back', severity: 'critical' },
        { type: 'mode_is', value: 'integration_guide', description: 'Mode is integration_guide', severity: 'critical' },
      ]
    }]
  },

  // ---- G. End Session ----
  {
    id: 'end_after_lead', group: 'end_session',
    description: 'After lead → professional close',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
      { userMessage: '好的，可以留个联系方式', assertions: [] },
    ],
    warmupTargetMode: 'end_session',
    turns: [{
      userMessage: '好的，信息填好了',
      assertions: [
        { type: 'no_action', description: 'No ACTION in end_session', severity: 'critical' },
        { type: 'contains_any', value: ['联系', '专家', '尽快', '顺利'], description: 'Professional close', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'end_after_refusal', group: 'end_session',
    description: 'After refusal → warm leave-the-door-open',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
      { userMessage: '不用了，我再看看', assertions: [] },
    ],
    warmupTargetMode: 'end_session',
    turns: [{
      userMessage: '那就先这样吧',
      assertions: [
        { type: 'no_action', description: 'No ACTION in end_session', severity: 'critical' },
        { type: 'contains_any', value: ['随时', '回来', '问题', '帮忙'], description: 'Warm leave-door-open', severity: 'soft' },
      ]
    }]
  },
  {
    id: 'end_no_actions', group: 'end_session',
    description: 'End session: no ACTIONS output',
    sessionMode: 'warm',
    warmupTurns: [
      { userMessage: '你好', assertions: [] },
      { userMessage: '了解了，我们做语聊房的', assertions: [] },
      { userMessage: '我们是个成熟企业', assertions: [] },
      { userMessage: '想试试看', assertions: [] },
      { userMessage: '好的，可以留个联系方式', assertions: [] },
    ],
    warmupTargetMode: 'end_session',
    turns: [{
      userMessage: '再见',
      assertions: [
        { type: 'no_action', description: 'No ACTIONS in end', severity: 'critical' },
      ]
    }]
  },
];

// ======================== Main Execution ========================

function parseArgs(): { group?: string; only?: string; variants?: string } {
  const args = process.argv.slice(2);
  let group: string | undefined;
  let only: string | undefined;
  let variants: string | undefined;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--group' && args[i + 1]) group = args[++i];
    if (args[i] === '--only' && args[i + 1]) only = args[++i];
    if (args[i] === '--variants' && args[i + 1]) variants = args[++i];
  }
  return { group, only, variants };
}

function filterScenarios(scenarios: VerificationScenario[], filter: { group?: string; only?: string }): VerificationScenario[] {
  let filtered = scenarios;
  if (filter.only) {
    filtered = filtered.filter(s => s.id === filter.only);
  } else if (filter.group) {
    filtered = filtered.filter(s => s.group === filter.group);
  }
  return filtered;
}

function fmtMs(v: number | null | undefined): string {
  return v != null ? `${v}ms` : 'N/A';
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ======================== Build Report ========================

interface VariantResult {
  variantId: string;
  scenarioResults: ScenarioResult[];
  reportPath: string;
}

function buildReport(
  results: ScenarioResult[],
  config: any,
  workspaceRoot: string,
  variantLabel?: string
): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = variantLabel ? `-${variantLabel}` : '';
  const reportPath = path.join(workspaceRoot, `verify-report${suffix}-${timestamp}.txt`);

  const lines: string[] = [];
  const sep = '=====================================================================';

  lines.push(sep);
  lines.push('ZEGO AI Assistant Verification Report');
  if (variantLabel) lines.push(`Prompt Variant: ${variantLabel}`);
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`Workspace: ${path.basename(workspaceRoot)}`);
  lines.push(`Model SLC: ${config.fastAgent.slcModel} / Model SLE: ${config.fastAgent.sleModel}`);
  lines.push(sep);

  const allLatencies: { total: number[]; ttft: number[]; router: number[]; slc: number[]; sle: number[]; tool: number[]; summarize: number[] } = {
    total: [], ttft: [], router: [], slc: [], sle: [], tool: [], summarize: []
  };

  for (const r of results) {
    lines.push('');
    lines.push(`--- Scenario: ${r.scenarioId} [${r.scenarioGroup}] ---`);
    lines.push(`  Description: ${r.description}`);

    for (const tr of r.turnResults) {
      lines.push(`  Turn ${tr.turnIndex + 1}:`);
      lines.push(`    Q: ${tr.userMessage}`);
      lines.push(`    A: ${tr.captured.fullText.substring(0, 500)}${tr.captured.fullText.length > 500 ? '...' : ''}`);

      const lat = tr.captured.latency;
      lines.push(`    Latency: total=${fmtMs(lat.totalMs)}, ttft=${fmtMs(lat.ttftMs)} | SLC=${fmtMs(lat.modules.slcMs)}, SLE=${fmtMs(lat.modules.sleMs)}, Tool=${fmtMs(lat.modules.toolMs)}, Summarize=${fmtMs(lat.modules.summarizeMs)}`);

      if (tr.captured.toolCalls.length > 0 || tr.captured.toolResultReceived) {
        const toolStatus = tr.captured.toolResultReceived
          ? `result received (${fmtMs(tr.captured.toolResultLatencyMs)})`
          : 'NO RESULT';
        lines.push(`    Tool calls: ${tr.captured.toolCalls.join(', ') || '(unknown)'} → ${toolStatus}`);
      }

      if (tr.captured.actions.length > 0) {
        lines.push(`    Actions: [${tr.captured.actions.map(a => `ACTION:${a}`).join(', ')}]`);
      }

      if (tr.captured.modeChanged) {
        lines.push(`    Mode: ${tr.captured.previousMode || '?'} → ${tr.captured.newMode || '?'}`);
      }

      if (tr.assertionResults.length > 0) {
        lines.push(`    Assertions:`);
        for (const ar of tr.assertionResults) {
          const icon = ar.passed ? 'PASS' : 'FAIL';
          const sev = ar.assertion.severity.toUpperCase();
          lines.push(`      [${icon}] [${sev}] ${ar.assertion.description} (${ar.actual})`);
        }
      }

      const turnIcon = tr.allCriticalPassed ? 'PASS' : 'FAIL';
      lines.push(`  Turn result: ${turnIcon}`);

      if (lat.totalMs > 0) allLatencies.total.push(lat.totalMs);
      if (lat.ttftMs != null) allLatencies.ttft.push(lat.ttftMs);
      if (lat.modules.routerMs != null) allLatencies.router.push(lat.modules.routerMs);
      if (lat.modules.slcMs != null) allLatencies.slc.push(lat.modules.slcMs);
      if (lat.modules.sleMs != null) allLatencies.sle.push(lat.modules.sleMs);
      if (lat.modules.toolMs != null) allLatencies.tool.push(lat.modules.toolMs);
      if (lat.modules.summarizeMs != null) allLatencies.summarize.push(lat.modules.summarizeMs);
    }
  }

  lines.push('');
  lines.push(sep);
  lines.push('LATENCY SUMMARY');
  lines.push(sep);
  lines.push('| Module        | Avg     | Min     | Max     | P95     |');
  lines.push('|---------------|---------|---------|---------|---------|');

  const latencyTable = [
    ['Total', allLatencies.total],
    ['TTFT', allLatencies.ttft],
    ['Router', allLatencies.router],
    ['SLC', allLatencies.slc],
    ['SLE', allLatencies.sle],
    ['Tool', allLatencies.tool],
    ['Summarize', allLatencies.summarize],
  ] as [string, number[]][];

  for (const [name, vals] of latencyTable) {
    if (vals.length === 0) {
      lines.push(`| ${name.padEnd(14)} | N/A     | N/A     | N/A     | N/A     |`);
    } else {
      const avg = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
      const min = Math.min(...vals);
      const max = Math.max(...vals);
      const p95 = percentile(vals, 95);
      lines.push(`| ${name.padEnd(14)} | ${String(avg + 'ms').padEnd(8)}| ${String(min + 'ms').padEnd(8)}| ${String(max + 'ms').padEnd(8)}| ${String(p95 + 'ms').padEnd(8)}|`);
    }
  }

  const totalScenarios = results.length;
  const passedScenarios = results.filter(r => r.overallCriticalPassed).length;
  const failedScenarios = totalScenarios - passedScenarios;
  const passRate = totalScenarios > 0 ? ((passedScenarios / totalScenarios) * 100).toFixed(1) : '0.0';

  lines.push('');
  lines.push(sep);
  lines.push('SUMMARY');
  lines.push(sep);
  lines.push(`Total scenarios: ${totalScenarios}`);
  lines.push(`Passed (all critical): ${passedScenarios}`);
  lines.push(`Failed (any critical): ${failedScenarios}`);
  lines.push(`Pass rate: ${passRate}%`);

  if (failedScenarios > 0) {
    lines.push('');
    lines.push('Failed scenarios:');
    for (const r of results.filter(r => !r.overallCriticalPassed)) {
      const failedAssertions = r.turnResults
        .flatMap(tr => tr.assertionResults)
        .filter(ar => !ar.passed && ar.assertion.severity === 'critical');
      const details = failedAssertions.map(ar => ar.assertion.description).join('; ');
      lines.push(`  - ${r.scenarioId}: ${details}`);
    }
  }

  lines.push(sep);

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  return reportPath;
}

// ======================== Single Variant Runner ========================

async function runSingleVariant(
  scenarios: VerificationScenario[],
  personaSubDir: string
): Promise<VariantResult> {
  const workspaceRoot = process.env.VOICE_GATEWAY_WORKSPACE
    || path.join(__dirname, '..', '..', 'openclaw-test-env', 'workspace_standalone_zegoAIAssistant');

  const config = {
    llm: {
      apiKey: process.env.BAILIAN_API_KEY,
      baseUrl: process.env.BAILIAN_BASE_URL,
      model: process.env.BAILIAN_MODEL || 'qwen-plus',
      provider: 'bailian'
    },
    fastAgent: {
      slcModel: process.env.SLC_MODEL || 'qwen-turbo',
      slcBaseUrl: process.env.SLC_BASE_URL || process.env.BAILIAN_BASE_URL,
      sleModel: process.env.BAILIAN_MODEL || 'qwen-plus',
      sleBaseUrl: process.env.BAILIAN_BASE_URL
    },
    zego: {
      appId: Number(process.env.ZEGO_APP_ID),
      serverSecret: process.env.ZEGO_SERVER_SECRET,
      aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL
    }
  };

  const label = personaSubDir || 'default';
  console.log(`\n🧪 Variant: ${label}`);
  console.log(`   Workspace: ${workspaceRoot}`);
  console.log(`   Scenarios: ${scenarios.length}`);
  console.log(`   SLC: ${config.fastAgent.slcModel} | SLE: ${config.fastAgent.sleModel}\n`);

  // Set persona sub dir via env var (read by FastAgentV3 constructor)
  if (personaSubDir) {
    process.env.VOICE_GATEWAY_PERSONA_SUBDIR = personaSubDir;
  } else {
    delete process.env.VOICE_GATEWAY_PERSONA_SUBDIR;
  }

  // [ARCH] 读取 variant.json 设置架构环境变量（在构造 FastAgent 之前）
  const variantConfigPath = path.join(workspaceRoot, 'prompts', personaSubDir, 'variant.json');
  if (fs.existsSync(variantConfigPath)) {
    const archConfig = JSON.parse(fs.readFileSync(variantConfigPath, 'utf-8'));
    if (archConfig.intentDecision === 'slc_prompt') {
      process.env.VOICE_GATEWAY_ARCH_INTENT = 'slc_prompt';
    } else {
      delete process.env.VOICE_GATEWAY_ARCH_INTENT;
    }
    if (archConfig.functionInvocation === 'func_tags') {
      process.env.VOICE_GATEWAY_ARCH_FUNC = 'func_tags';
      process.env.VOICE_GATEWAY_ARCH_FUNC_SYNTAX = archConfig.funcSyntax || 'func_call';
    } else {
      delete process.env.VOICE_GATEWAY_ARCH_FUNC;
      delete process.env.VOICE_GATEWAY_ARCH_FUNC_SYNTAX;
    }
    console.log(`   ARCH: intent=${archConfig.intentDecision}, func=${archConfig.functionInvocation}, syntax=${archConfig.funcSyntax || 'N/A'}`);
  } else {
    // 无 variant.json 时清除架构环境变量（向后兼容）
    delete process.env.VOICE_GATEWAY_ARCH_INTENT;
    delete process.env.VOICE_GATEWAY_ARCH_FUNC;
    delete process.env.VOICE_GATEWAY_ARCH_FUNC_SYNTAX;
  }

  const agent = new FastAgent(config as any, workspaceRoot);
  const results: ScenarioResult[] = [];
  let prevCallId: string | undefined;
  let prevActions: string[] = [];

  for (const scenario of scenarios) {
    console.log(`▶ [${label}] ${scenario.id} [${scenario.group}] - ${scenario.description}`);

    const startTime = Date.now();
    const turnResults: TurnResult[] = [];
    let callId: string;
    const messages: any[] = [];

    if (scenario.sessionMode === 'fresh' || scenario.sessionMode === 'warm') {
      if (prevCallId) {
        try { agent.destroySession(prevCallId); } catch {}
      }
      callId = `verify-${scenario.id}-${Date.now()}`;
      messages.length = 0;
      prevActions = [];
    } else {
      callId = prevCallId || `verify-${scenario.id}-${Date.now()}`;
    }

    if (scenario.sessionMode === 'warm' && scenario.warmupTurns) {
      for (const wt of scenario.warmupTurns) {
        const captured = await sendTurn(agent, wt.userMessage, callId);
        messages.push({ role: 'user', content: wt.userMessage });
        messages.push({ role: 'assistant', content: captured.fullText });
        prevActions = captured.actions.length > 0 ? captured.actions : prevActions;
        await new Promise(r => setTimeout(r, 500));
      }
      if (scenario.warmupTargetMode) {
        console.log(`  ⏳ Warmup complete (target: ${scenario.warmupTargetMode})`);
      }
    }

    for (let i = 0; i < scenario.turns.length; i++) {
      const turn = scenario.turns[i];
      if (turn.delayBeforeMs) {
        await new Promise(r => setTimeout(r, turn.delayBeforeMs));
      }

      const captured = await sendTurn(agent, turn.userMessage, callId);
      messages.push({ role: 'user', content: turn.userMessage });
      messages.push({ role: 'assistant', content: captured.fullText });

      const allAssertions = withGlobalAssertions(turn.assertions);
      const assertionResults = evaluateAssertions(captured, allAssertions, prevActions);
      const allCriticalPassed = assertionResults
        .filter(ar => ar.assertion.severity === 'critical')
        .every(ar => ar.passed);

      turnResults.push({
        turnIndex: i,
        userMessage: turn.userMessage,
        captured,
        assertionResults,
        allCriticalPassed,
      });

      prevActions = captured.actions.length > 0 ? captured.actions : prevActions;

      const passIcon = allCriticalPassed ? '✓' : '✗';
      console.log(`  ${passIcon} Turn ${i + 1}: ${turn.userMessage.substring(0, 30)}... → ${captured.fullText.substring(0, 40)}...`);

      await new Promise(r => setTimeout(r, 500));
    }

    const endTime = Date.now();
    const overallCriticalPassed = turnResults.every(tr => tr.allCriticalPassed);

    results.push({
      scenarioId: scenario.id,
      scenarioGroup: scenario.group,
      description: scenario.description,
      turnResults,
      overallCriticalPassed,
      startTime,
      endTime,
    });

    prevCallId = callId;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (prevCallId) {
    try { agent.destroySession(prevCallId); } catch {}
  }
  agent.destroy();

  const reportPath = buildReport(results, config, workspaceRoot, label);
  console.log(`\n📄 Report saved to: ${reportPath}`);

  return { variantId: label, scenarioResults: results, reportPath };
}

// ======================== Comparison Report ========================

function buildComparisonReport(variantResults: VariantResult[], workspaceRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(workspaceRoot, `verify-comparison-${timestamp}.txt`);

  const lines: string[] = [];
  const sep = '=====================================================================';

  lines.push(sep);
  lines.push('PROMPT VARIANT COMPARISON REPORT');
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`Variants: ${variantResults.map(v => v.variantId).join(', ')}`);
  lines.push(sep);

  // Collect all scenario IDs (same across variants)
  const scenarioIds = variantResults[0]?.scenarioResults.map(r => r.scenarioId) || [];

  // Per-scenario comparison table
  const colWidth = Math.max(...variantResults.map(v => v.variantId.length), 8) + 2;
  const scenarioColWidth = Math.max(...scenarioIds.map(id => id.length), 10) + 2;
  const headerSep = '-'.repeat(scenarioColWidth) + '|' + variantResults.map(() => '-'.repeat(colWidth)).join('|');

  lines.push('');
  lines.push('Per-Scenario Results:');
  lines.push(`${'Scenario'.padEnd(scenarioColWidth)}|${variantResults.map(v => v.variantId.padEnd(colWidth)).join('|')}`);
  lines.push(headerSep);

  for (const sid of scenarioIds) {
    const cells = variantResults.map(vr => {
      const sr = vr.scenarioResults.find(r => r.scenarioId === sid);
      return sr ? (sr.overallCriticalPassed ? 'PASS'.padEnd(colWidth) : 'FAIL'.padEnd(colWidth)) : '  -  '.padEnd(colWidth);
    });
    lines.push(`${sid.padEnd(scenarioColWidth)}|${cells.join('|')}`);
  }

  lines.push(headerSep);

  // Pass rate row
  const rateCells = variantResults.map(vr => {
    const total = vr.scenarioResults.length;
    const passed = vr.scenarioResults.filter(r => r.overallCriticalPassed).length;
    const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
    return `${rate}%`.padEnd(colWidth);
  });
  lines.push(`${'Pass Rate'.padEnd(scenarioColWidth)}|${rateCells.join('|')}`);

  // Passed count row
  const countCells = variantResults.map(vr => {
    const total = vr.scenarioResults.length;
    const passed = vr.scenarioResults.filter(r => r.overallCriticalPassed).length;
    return `${passed}/${total}`.padEnd(colWidth);
  });
  lines.push(`${'Passed'.padEnd(scenarioColWidth)}|${countCells.join('|')}`);

  // Per-variant failed scenario details
  for (const vr of variantResults) {
    const failed = vr.scenarioResults.filter(r => !r.overallCriticalPassed);
    if (failed.length > 0) {
      lines.push('');
      lines.push(`Failed scenarios [${vr.variantId}]:`);
      for (const r of failed) {
        const failedAssertions = r.turnResults
          .flatMap(tr => tr.assertionResults)
          .filter(ar => !ar.passed && ar.assertion.severity === 'critical');
        const details = failedAssertions.map(ar => ar.assertion.description).join('; ');
        lines.push(`  - ${r.scenarioId}: ${details}`);
      }
    }
  }

  // Diff: scenarios that differ across variants
  const differing = scenarioIds.filter(sid => {
    const outcomes = variantResults.map(vr =>
      vr.scenarioResults.find(r => r.scenarioId === sid)?.overallCriticalPassed
    );
    return new Set(outcomes).size > 1;
  });
  if (differing.length > 0) {
    lines.push('');
    lines.push('Scenarios with differing outcomes across variants:');
    for (const sid of differing) {
      const outcomes = variantResults.map(vr => {
        const sr = vr.scenarioResults.find(r => r.scenarioId === sid);
        return `${vr.variantId}=${sr?.overallCriticalPassed ? 'PASS' : 'FAIL'}`;
      });
      lines.push(`  - ${sid}: ${outcomes.join(', ')}`);
    }
  }

  lines.push('');
  lines.push('Detailed reports per variant:');
  for (const vr of variantResults) {
    lines.push(`  - ${vr.variantId}: ${vr.reportPath}`);
  }

  lines.push(sep);

  fs.writeFileSync(reportPath, lines.join('\n'), 'utf-8');
  return reportPath;
}

// ======================== Main ========================

async function main() {
  const filter = parseArgs();
  const scenarios = filterScenarios(ALL_SCENARIOS, filter);

  if (scenarios.length === 0) {
    console.log('No scenarios matched filter. Available groups:', [...new Set(ALL_SCENARIOS.map(s => s.group))].join(', '));
    process.exit(1);
  }

  const workspaceRoot = process.env.VOICE_GATEWAY_WORKSPACE
    || path.join(__dirname, '..', '..', 'openclaw-test-env', 'workspace_standalone_zegoAIAssistant');

  // --variants mode: run comparison across multiple prompt variants
  if (filter.variants) {
    const variantIds = filter.variants.split(',').map(v => v.trim()).filter(Boolean);
    if (variantIds.length < 2) {
      console.log('Error: --variants requires at least 2 comma-separated variant IDs (e.g. v1_baseline,v2_tone)');
      process.exit(1);
    }

    // Validate subdirectories exist
    for (const vid of variantIds) {
      const subDir = path.join(workspaceRoot, 'prompts', vid);
      if (!fs.existsSync(subDir)) {
        console.log(`Error: variant directory not found: ${subDir}`);
        console.log('Available variants:', fs.readdirSync(path.join(workspaceRoot, 'prompts')).join(', '));
        process.exit(1);
      }
    }

    console.log(`\n🔬 Prompt Variant Comparison Mode`);
    console.log(`   Variants: ${variantIds.join(', ')}`);
    console.log(`   Scenarios: ${scenarios.length}\n`);

    const variantResults: VariantResult[] = [];
    for (const vid of variantIds) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`  Running variant: ${vid}`);
      console.log(`${'='.repeat(60)}`);
      const result = await runSingleVariant(scenarios, vid);
      variantResults.push(result);
    }

    // Build comparison report
    const comparisonPath = buildComparisonReport(variantResults, workspaceRoot);
    console.log(`\n📊 Comparison report saved to: ${comparisonPath}`);

    // Console summary
    const sep = '=====================================================================';
    console.log(`\n${sep}`);
    console.log('COMPARISON SUMMARY');
    console.log(sep);
    for (const vr of variantResults) {
      const total = vr.scenarioResults.length;
      const passed = vr.scenarioResults.filter(r => r.overallCriticalPassed).length;
      const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';
      console.log(`  ${vr.variantId}: ${passed}/${total} passed (${rate}%)`);
    }
    console.log(sep);

    process.exit(0);
  }

  // Default: single variant run (backward compatible)
  const result = await runSingleVariant(scenarios, '');

  // Console summary
  const sep = '=====================================================================';
  const total = result.scenarioResults.length;
  const passed = result.scenarioResults.filter(r => r.overallCriticalPassed).length;
  const failed = total - passed;
  const rate = total > 0 ? ((passed / total) * 100).toFixed(1) : '0.0';

  console.log(`\n${sep}`);
  console.log(`SUMMARY: ${passed}/${total} passed (${rate}%)`);
  if (failed > 0) {
    console.log(`Failed: ${result.scenarioResults.filter(r => !r.overallCriticalPassed).map(r => r.scenarioId).join(', ')}`);
  }
  console.log(sep);

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(2);
});
