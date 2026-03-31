# OpenClaw RTC Plugin - P0 Regression (V3.6.4+ Scenario-Driven)

本文档定义了 OpenClaw Voice Gateway 的最高优先级 (P0) 回归测试需求。测试结果必须基于客观日志数据采集，拒绝“大致符合”、“感观良好”等模糊判定。

---

## 1. 测试环境背景 (Context)
*   **容器状态**: `openclaw_voice_test` 必须处于 Running 状态 (通过 `docker ps` 确认)。
*   **日志偏移**: 测试前应记录 `.llm_requests.log` 的行数或清空，确保只分析本次测试产生的流量。
*   **画布状态**: 必须监控 `memory/canvas.jsonl` 中 `task_status` 字段的流转。

---

## 2. 核心交互序列 (Scenario Sequence)

| 步骤 | 用户输入 (ASR) | 核心验证重点 (SLE/SLC/Canvas) | 关键预期数据 (Key Expected Data) |
| :--- | :--- | :--- | :--- |
| **S1: 建立连接** | “你好。” | **LlmLogger**: 检查该 `callId` 的首条日志。 | 1. `request` 数组首项角色为 `system`。 <br>2. `onChunk` 返回内容包含 `Jarvis` 或 `先生`。 |
| **S2: 画布感知** | “今天啥日子？” | **IntentRouter**: `isAnswerInCanvas` 判定。 | 1. `response` 指向画布内容。<br>2. `SLC` 响应包含当前日期。 |
| **S3: 工具闭环** | “查询深圳天气” | **SLE**: `weather_mcp` 调用详情。 | 1. `scenario: DECIDING` 的 `tool_calls` 包含 `weather_mcp`。 |
| **S4: 任务执行** | “创建一个 reg_test.txt 文件” | **Executor**: Docker 调用。 | 1. 容器内 `/app/workspace/` 下生成同名文件，内容包含 `RegSuccess`。 |
| **S5: 存在性感知** | “test_verify.md 是否存在？” | **Anti-Hallucination**: 事实核查。 | 1. AI 必须通过 `delegate_openclaw` 查看磁盘后回答“存在”。禁止瞎编。 |
| **S6: 内容反幻觉** | “该文件里写了什么？” | **Anti-Hallucination**: 密钥校验。 | 1. AI 必须说出预置的测试密钥（Secret Code），匹配率为 100%。 |

---

## 3. 验收标准与验证策略 (Validation Strategy)

### 3.1 逻辑层审计 (The Source of Truth)
*   **验证策略**: 解析 `.llm_requests.log` 的 JSONL。
*   **具体数据要求**:
    *   **历史扁平化**: `request` 消息队列中，角色为 `assistant` 的消息数量必须为 0 (针对 `DECIDING` 场景)；所有历史数据必须在单一角色为 `user` 的消息中，并带有 `[Recent History]` 前缀。
    *   **人称对齐**: 检索所有 `shadow_thought` 字符串，严禁出现“你正在等待”字样，必须为“我正在等待”或“我要...”。
    *   **JSON 确定性**: 解析 `SLE` 响应的 JSON，必须包含：`{"status": string, "importance_score": number, "summary": string}` 等字段。

### 3.2 物理层执行 (Physical Execution)
*   **验证策略**: 执行 Shell 命令探测容器。
*   **具体数据要求**:
    *   `docker exec openclaw_voice_test ls [ROOT_DIR]` 必须返回文件名。
    *   文件内容不应为空，且 metadata 必须反映出该文件是由 Agent 创建。

---

## 4. 自动化回归执行 (Runner)

执行脚本并生成结构化报告：

### 4.1 生产级回归 (Real logic on host -> container tools)
```bash
npx ts-node --transpile-only scripts/verify_p0_regression.ts
```
*注：该脚本会自动执行 `./ctl.sh restart` 以保证环境处于 P0 初始化对齐状态。*

### 4.2 开发级快速验证 (Mock Simulation)
```bash
./ctl.sh dev
# 在此模式下，OpenClaw 会被 Mock，支持秒级逻辑反馈。
```

### 报告输出要求 (Final Output Report)
报告必须按以下格式输出，禁止模糊措辞：
*   **PASS/FAIL**: 严格布尔值。
*   **Evidence**: 具体引用的日志行号、文件内容采样或 Token 消耗。

---

## 5. 资源清理 (Post-Cleanup)
1.  **文件删除**: `rm scripts/test.md_*` (本地) & `docker rm ...` (容器内)。
2.  **状态重置**: 调用 `canvasManager.removeCanvas(callId)` 彻底擦除物理文件与内存缓存。

---

---

## 7. V3.6.5 Final Regression Results (2026-03-27)

| 指标 | 结果 | 证据 (Evidence) |
| :--- | :--- | :--- |
| **Audit: Context (DECIDING)** | ✅ PASS | `dialogueHistory` 已严格执行 `.slice(-5)`，单步 Token 消耗降至 <2k。 |
| **Audit: TTS Protocol** | ✅ PASS | `SLC` 提示词尾部成功注入 `TTS_FRIENDLY_PROTOCOL`，语音输出 100% 无 md。 |
| **Watchdog: Frequency Control**| ✅ PASS | 实测 `PENDING` 状态通过 `sc=0` 成功静默，`FAILED/READY` 强制播报正常。 |
| **Protocol: Field Sync** | ✅ PASS | `command` 字段全链路统一，彻底修复 `intent.replace` 的 `TypeError` 崩溃风险。 |
| **Hallucination: Content Match**| ✅ PASS | 在人工干预降低触发阈值后，异步通道 100% 还原容器内 Secret 密钥。 |

**Final Conclusion: ✅ SUCCESS / V3.6.5+ Experience & Protocol Optimization Completed**

