# Web 目录工程化重构计划 (Web Rebuild Plan)

> **目标**: 将 `web` 目录下的古旧 Vanilla JS/HTML 结构彻底粉碎，基于 Vite + React + TypeScript + TailwindCSS 重新整合成现代化的企业级前端工程，并 1:1 完美复刻 `doc/promo_prototype.html` 的极限视觉动效体验。
> **核心驱动**: 完全基于 ZEGO Express Web SDK 的 `onRecvRoomChannelMessage` 实验性接口进行真实的实时信令驱动（并由前端 Mock 接管尚未完成的 Webhook 效果）。

---

## 🏗️ 1. 脚手架与依赖搭建 (Infrastructure)

我们将首先清空现有的 `web` 目录，并初始化以下架构：
*   **构建工具**: Vite
*   **前端框架**: React 18 + TypeScript
*   **样式方案**: TailwindCSS v3 (并迁移原型中所有的自定义变量、`keyframes` 与玻璃态滤镜)
*   **核心引擎**: `zego-express-engine-webrtc` (基于 CDN 或 npm 包，与后端网关交互)

## 🧩 2. 核心视觉组件化体系 (Component Architecture)

不再允许单文件堆砌代码，我们将按职能进行原子化和容器化拆解：

| 组件文件 (src/components) | 职责描述与工程化改造要点 |
| :--- | :--- |
| `AuroraBackground.tsx` | **深空极光层**: 收拢所有绝对定位的 `mix-blend-screen` 气泡层，通过 `will-change: transform, filter` 和 `Translate3d` 硬件加速优化性能，解决极光动画耗费 GPU 的问题。 |
| `FluidVoiceCore.tsx` | **流体发光球**: 取代原型中的直接 DOM 操作。监听 Context/Store 传递的 `coreState` (`IDLE`, `LISTENING`, `SPEAKING`, `WARNING`) 动态渲染。并内置打字时的 `triggerCorePulse` 抽搐型物理计算动画。 |
| `GlassWidget.tsx` | **悬浮 Webhook 面板**: 根据统一的 Store 弹出，显示任务进度队列，使用 `backdrop-filter: blur(24px)` 结合独立的渲染层以保性能。这里将通过**前端写死的 Mock 数据**触发展示，不依赖现有真实信令连贯。 |
| `SubtitleStream.tsx` | **流式字幕弹匣**: 废弃原型的绝对索引和样式修改操作。接入类似 CSS Animations / Keyframes 或动画库，提供新消息上滑与旧消息衰退 (opacity decay, blur) 的队列机制。 |
| `TerminalEnding.tsx` | **CTA 结尾黑底终端**: 纯粹使用 React 状态控制显示，并按字符流式打印。 |

## 🕹️ 3. 状态管理与信令驱动设计 (useAgentSync.ts)

所有 UI 渲染不再依赖定时器 `scenes` 数组瞎蒙，而是通过一套统一的 **Zego Signaling Hook** 进行管理。
工作流：
1.  **网桥连结**: 向本地 `http://localhost:18789/voice/start-call` 获取 Zego 房间票据与网关连通（保留原有 `app.js` 的联调逻辑）。
2.  **ZEGO 监听注入**: 开启 `zg.callExperimentalAPI({ method: "onRecvRoomChannelMessage" })`。
    *   **Cmd 3 (用户 ASR 语音识别)**：解析文字并投递到客户端字幕区栈内。切分断句。
    *   **Cmd 4 (LLM 大模型吐字)**：解析为 AI 字幕块，并在输出时动态触发 `FluidVoiceCore` 的“心脏脉冲”。
3.  **Webhook Mock 层**: 编写一个独立于 ZEGO 的计时发射器 `startMockWebhookSequence()`，在通话进展到特定时间节点时，由前端自己产生 `onWebhookTrigged` 信号来激活 Widget 面板（比如查询备忘录、发送邮件的演示）。

## 🛡️ 4. 实施与推进步骤

1.  **【破坏性操作】清理旧 Web**: `rm -rf web/*` (如果需要，我们会备份 `app.js` 以备接口调试参考)。
2.  **初始化 Vite 项目**: `npx create-vite web --template react-ts` ，配置 `tailwind.config.js`。
3.  **迁移 SDK 与登录逻辑**: 重写 `src/App.tsx` 中的登录交互，确保获取 Token 并与 ZEGO 服务器建立稳定的流媒体关联。
4.  **搬运与组件拆分**: 依照原型中的 `style` 和 `div` 结构，翻译为现代的 TSX 组件，特别是对打字机光标 (`inline-cursor`) 的重现。
5.  **信令绑定与动效联调**: 测试真正的说话/打字时的触发，调整随机延迟算法，实现真实拟人性。

---
**⚠️ 总结与批准**:
该计划明确了将抛弃原生 JS 架构，改用 React + Tailwind 实现，并且统一遵守 ZEGO Web 实验性 API 捕获事件；针对未有真实支撑的 Webhook 则由前端进行 Mock 代管。
