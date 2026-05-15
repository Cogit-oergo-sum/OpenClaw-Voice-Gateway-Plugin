# OpenClaw 语音网关 - 记忆沉淀与偏好约束 (V3.7 阶段)

## 1. 架构调整与任务状态流转约束
- **任务播报原子化流转 (User Feedback)**
  正确的执行与感知链路应严格遵守：
  1. **ASR 识别完成** -> `SLC` 给出垫词（如“正在查询中心...”）
  2. **工具执行结束** -> `SLE` 提纯结果 -> `AgentOrchestrator` / `ToolResultHandler` 将解析后的摘要写入 Canvas，并将状态变更为 `READY` (或 `COMPLETED`/`FAILED`)。
  3. **Watchdog 发现状态** -> 检测到 `READY` 状态，触发聚合播报。
  4. **SLC 最终播报** -> `AgentOrchestrator` 执行 `SLC` 以呈现任务结果给用户。
- **避免过早置标 `is_delivered = true`**：不要在 `Watchdog` 轮询时单纯触发并在同等位置立刻 `is_delivered = true` 并写盘，这会导致 `SLC` / `AgentOrchestrator` 在获取画布记录时，判定该记录已被播报从而静默。

## 2. 状态存储与多任务锁定机制
- **ShadowContext 的非并发隐患**：`AsyncLocalStorage` (用作 callContext) 经常在后台异步或全局触发的任务中丢失。针对诸如人设提取等独立长时后台任务，更新 ShadowState（如 `compact_persona`）时必须显式传递 `callId` 绕过环境隔离限制（`updateState(delta, callId)`）。
- **Orchestrator 锁机制升级**：抢占式调度允许用户输入能够中断正在进行的内部播报 (`internal`) 或空闲播报 (`idle`)。

## 3. 代码约束与习惯
- 保持 `slc.ts` (极速与交互) 和 `sle.ts` (分析与决策) 的纯粹性。
- 代码输出以精确的 Chunk 级别 Diff 为主，切忌全量覆写。
- 当处理 `targetTasks` 的提纯结果 (`direct_response`) 填充时，务必落库 Canvas 并持久化，使下一轮 `SLC` 能够检索到确定的内容进行潜意识拼装。
