# OpenClaw 语音网关 UI 工程化落地指南 (Production Handoff)

> **文档目的**：本指南用于指导后续的前端工程师或 AI Agent，如何将 `doc/promo_prototype.html` 这个表现层原型，1:1 高保真地逆向、拆解并重构为可实际上线的企业级前端工程（推荐技术栈：React / Vue3 + TailwindCSS + WebSocket/WebRTC）。

---

## 1. 核心架构拆解与组件化建议

在真实的开发工程中，不要尝试将原型的所有杂糅代码放在一个文件中。建议拆解为以下核心视图树：

```text
src/
├── components/
│   ├── AuroraBackground.tsx      # 深空极光混合背景 (管理底层气氛)
│   ├── FluidVoiceCore.tsx        # 三层流体语音核心球 (全屏绝对居中)
│   ├── GlassWidget.tsx           # 毛玻璃并发状态面板 (右上角或悬浮流)
│   ├── StreamingSubtitles.tsx    # 流式打字机弹匣容器 (管理字幕出区衰退机制)
│   └── TerminalEnding.tsx        # CTA 终端收尾特效 (绝对覆盖层)
├── hooks/
│   ├── useAudioLevel.ts          # 用于计算 WebRTC 音轨音量，驱动核心球物理缩放
│   └── useAgentState.ts          # 管理 AI 的多路并发状态机 (Idle, Litsening, Speaking)
```

## 2. 状态驱动映射映射表 (State Machine Mapping)

原型中的交互是基于“点击屏幕”触发下一幕，但在实际工程中，**所有状态改变必须由底层实时信令或流式 Token 驱动**。

| 真实底层事件 (Event) | 对应 UI 状态更新 (Trigger) | 组件渲染表现 (Visual) |
| :--- | :--- | :--- |
| `onVADStart()` / 检测到用户说话 | 进入 `state-listening` | 背景转 cyan；流体球转浅青色，开始监听微颤。 |
| `onASRRecognized(text)` / 语音转文字 | `SubtitleStream` 推送新字幕行（标为 user） | 用户气泡升起，根据 ASR 长度逐块/整块渲染上屏。 |
| `onAgentTyping(token)` / AI 大模型吐字 | `SubtitleStream` 流式追加字幕（标为 ai） | 触发 `triggerCorePulse`，AI 气泡逐字输出，流体球跟随字频和标点停顿产生抽搐级物理脉冲。 |
| `onAgentSpeaking()` / TTS 流下发 | 进入 `state-speaking` | 背景转 blue；流体球发出稳定且高频的蓝色波动。 |
| `onWebhookTrigged(taskName)` | 呼出 `GlassWidget` | 在右上角弹出带 backdrop-blur 的卡片，显示独立进度条。 |
| `onPrioritySpeech(text)` / 高优先级插播 | 进入 `state-warning` 并插播字幕 | 流体球和部分极光渲染层强制切为警告红/橙色，展现强烈打断视觉。 |

## 3. CSS 与动效深水区还原说明

原型页面极其依赖 CSS 高级特性，在将 Tailwind 样式挪入工程化配置时，不可忽视下述优化：

### 3.1 深空极光背景 (Aurora Mesh Gradient)
*   **工程化实现**：原型中是依赖 `mix-blend-screen` 和 `blur-[120px]` 实现在一个固定容器里的。如果在带低端 Android 设备的混合 App 容器中跑，会导致极其严重的 GPU 发热。
*   **优化方案**：在 React 中，可以尝试改用 **WebGL (Three.js 或是 react-three-fiber)** 来写一个自定义 Shader 渲染高斯流体，这样反而能释放 DOM 树的渲染压力；如果坚持用 CSS，请必须为极光球添加 `will-change: transform, filter` 以及开启硬件加速 `transform: translateZ(0)`。

### 3.2 毛玻璃算力优化 (Glassmorphism)
*   `backdrop-filter: blur(24px)` 在暗黑主题下具有极佳的高级质感，但是它对底图的采样重绘非常耗时。
*   **优化方案**：当 Widget 内部的文字 (比如高频更新的 `log` 或 `progress`) 在以 `RequestAnimationFrame` 或者 `setInterval` 重绘时，可能会触发整个背景板连带计算。务必确保 `widget-progress` 和内部文字独占渲染层 (`Translate3d(0,0,0)`)。

### 3.3 气泡退场推移算法 (Dom Decay Logic)
*   原型代码中的 `refreshHistoryStyles()` 用于控制三四行之上的老字幕变淡。在 React / Vue 中，**绝对不要使用类似 index 来强行修改 DOM Style 这种做法**。
*   **重构方案**：应该采用例如 `Framer Motion` (对于 React) 或 `<TransitionGroup>` (对于 Vue)。基于列表中条目的数组索引实时计算出变幻的 Props：
    *   `index === list.length - 1`: { opacity: 1, blur: '0px', y: 0 }
    *   `index === list.length - 2`: { opacity: 0.8, blur: '0px', y: -10 }
    *   `index === list.length - 3`: { opacity: 0.2, blur: '3px', y: -25 }

---

## 4. 防伪与核心动效引擎提取

在复原 `流式打字物理抽搐联动` 这一极其惊艳的效果时，请直接剥析原型代码内的以下两个函数，这是注入“人工灵魂”的核心依据：
1. `triggerCorePulse(isAi)`: 实现了 `scale(1.2)` 和延时还原。在 React 中可以绑定到全局 `ref` 上进行直接操纵。
2. `延迟随机生成器`: 
   `let delay = isAI ? Math.random() * 50 + 150 : Math.random() * 80 + 200; `
   千万不要在生产环境使用固定的 50ms 流式动画，否则就会沦为“机器人”。保留这种 `Math.random()` 并判断文本中的“，。！？”进行断句。
