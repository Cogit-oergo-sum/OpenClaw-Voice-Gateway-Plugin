# Fast Agent 军规交互与性能验证计划 (MIL-SPEC V2)

## 1. 测试目标
本计划旨在通过 100+ 真实场景的自动化压测，对 Fast Agent (V1.9.0) 的三个维度进行深度审计：

### A. 军规级交互审计 (Interaction Rigor)
*   **拒绝机器人化**：严禁出现“正在/已、处理中、请求、确认”等技术报备词。
*   **DRY 原则**：禁止复述用户提供的长参数（地址、手机号、代码段等）。
*   **事实污染防范 (New)**：SLC (抢跑流) 严禁对事实性问题（天气、数据等）进行瞎猜/幻觉，只能提供纯语气垫词。
*   **情绪对齐**：针对不同语气的用户输入，SLC 必须给出对应的拟人化本能反馈。

### B. 体感延迟审计 (Acoustic Latency)
*   **双 TTFT 监测**：记录 SLC TTFT 和 SLE TTFT。
*   **断层监测 (Acoustical Gap)**：基于 **3 字/秒** 的模拟说话速度，计算 SLC 播放结束与 SLE 首句开始之间的“冷场”时长。目标：冷场间隙应控制在 **2s** 以内。
*   **静默占位验证 (Acoustic Keep-alive)**：针对 SLE 延迟 > 1.2s 的场景，验证系统是否自动注入了非言语占位语（Acoustic Filler）以防止死线感。

### C. 双向反馈闭环审计 (Loop Integrity)
*   **工具播报闭环**：验证 `delegate_openclaw` 的结果是否能 100% 穿透至 Fast Agent 并成功播报。
*   **反问透传 (Clarification Passthrough)**：模拟当 OpenClaw 需要用户提供额外信息（追问）时，Fast Agent 是否能原封不动将问题抛给用户，并维持多轮对话上下文。
*   **ASR 隐形纠错验证**：模拟带错别字的文本输入，验证 SLE 是否能在不显式报补的情况下基于上下文自动纠正语义。
*   **主动播报触发 (voice_speak)**：验证外部进程调用 `voice_speak` 时，Fast Agent 的异步通知通知链路是否通畅。

## 2. 测试集规模与覆盖 (100+ Scenarios)
测试集将通过生成的语料库覆盖以下矩阵：
1.  **日常对话 (30%)**：寒暄、闲聊、情绪宣泄。
2.  **快速任务 (40%)**：查询天气、创建简单文件、查询系统负载、简单计算。
3.  **长/定时任务 (30%)**：定时提醒（如：1min 后）、大规模重构、复杂搜索、邮件发送。

## 3. 执行工具：MIL-SPEC-V2-DRIVER
我们将开发 `scripts/mil-spec-test-v2.ts`，引入以下核心模块：
*   **Speech Simulator**：根据文本长度模拟 TTS 播放时间，用于计算体感 Gap。
*   **Multi-Turn Sandbox**：支持模拟多轮对话，专门测试“追问-反馈-闭环”链路。
*   **LLM Auditor (Evaluator)**：升级评审 Prompt，识别“事实污染”和“技术禁词”。

## 4. 期待产出报告指标
*   **Pass Rate**：军规通过率。
*   **Avg Acoustic Gap**：平均体感冷场时长。
*   **Hallucination Incidence**：SLC 瞎猜发生率。
*   **Clarification Success Rate**：反问透传成功率。

---
**核准状态**：待测试...
**计划制定人**：Antigravity Agent (Integrated with OpenClaw Spec)
