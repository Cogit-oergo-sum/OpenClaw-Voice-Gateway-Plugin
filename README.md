# OpenClaw Voice Gateway Plugin (语音网关插件)

这是一个为 [OpenClaw](https://github.com/openclaw/openclaw) 量身定制的**生产级**实时语音网关插件。
它利用 ZEGO (即构科技) 的大模型低延迟 RTC 链路，与 OpenClaw 强大的工作区和主 Agent 无缝对接。

## 🌟 核心突破：Fast Agent 并联接力架构 (v1.6.0)

本插件内置了最新的 **Parallel Relay Architecture**，解决了语音 AI 交互中的“逻辑延迟”与“物理体感”断层：

- **双路赛跑 (Twin-Stream Racing)**：
  - **SLC (Soul-Light-Chat)**: 200ms 内发起感官级响应（如“我在，先生”），彻底抹平 LLM 思考时间。
  - **SLE (Soul-Logic-Expert)**: 后台执行复杂逻辑与工具调用。
- **语义缝合 (Semantic Smoothing)**：SLE 自动感知 SLC 已经下发的物理文本片段，通过 Assistant Prefill 协议实现无缝接力，杜绝“复读”和“断句不自然”。
- **会话物理隔离**：基于 `AsyncLocalStorage` 实现 `CallID` 级别的生产级隔离，支持高并发多路通话不混号。
- **事务级影子状态 (WAL)**：集成 Write-Ahead Logging 机制，所有 Agent 状态变更先落日志再入内存，支持系统崩溃后的 100% 幂等恢复。
- **思考哨兵 (Watchdog)**：1.2s 超时自动注入非言语采样（Acoustic Filler），维持通话热度，消除“二次冷场”。

---

## 🚀 一、部署与挂载 (如何把插件装进 OpenClaw)

**不要只在本地 `npm run build` 就结束了！** 你必须将产物交给 OpenClaw 宿主程序。

### 1. 编译插件产物
首先，进入本插件的源码目录，安装依赖并编译出 `dist` 目录：
```bash
cd voice-gateway
npm install
npm run build
```

### 2. 将插件挂载到 OpenClaw 宿主
OpenClaw 需要通过硬链接或拷贝的方式识别插件。你有两种标准挂载方式：
- **【方式 B（生产部署）】**：直接把整个 `voice-gateway` 文件夹拖入你的 OpenClaw 实例的 `plugins/` 挂载目录中。
- **【方式 A（推荐调试）】**：使用 OpenClaw 命令行将本地路径 link 为插件包：
  ```bash
  openclaw plugin link /绝对路径/voice-gateway
  ```

重启 OpenClaw 主控程序，当看到日志打印 `VoiceGateway Plugin routes registered successfully` 时，代表插件已成功点火登舱！

---

## 🧪 二、验证与压测

集成 V1.6.0 后，你可以通过内置脚本进行工程级的验收：

### 1. 逻辑体感验证
模拟真实的 RTC 流量入口，观察双路赛跑的缝合效果：
```bash
npx ts-node scripts/verify-v160-logic.ts
```

### 2. 并发压力测试
验证 `AsyncLocalStorage` 隔离性与 WAL 写入瓶颈（默认 50 路并发）：
```bash
npx ts-node scripts/stress-test-v160-concurrency.ts
```

---

## ⚙️ 三、核心配置 (配置文件到底写在哪？)

配置建议通过 OpenClaw 前端面板完成，或手动创建 `config.json`：

```json
{
  "zego": {
    "appId": 123456789,
    "serverSecret": "...",
    "aiAgentBaseUrl": "https://aigc-aiagent-api.zegotech.cn"
  },
  "llm": {
    "provider": "openai",      
    "apiKey": "sk-...",
    "model": "doubao-lite-32k",
    "baseUrl": "https://..."
  }
}
```

---

## 🎮 四、一键沙盒跑测！(React + Vite 版)

本插件配套了一套极具视觉冲击力的 React Web 客户端。

### 1. 启动 Web 终端
```bash
cd web
npm install
npm run dev
```

### ⚠️ 致命警告：HTTPS 限制
`getUserMedia` 只能在 `localhost` 或 `HTTPS` 环境下工作。若跨设备测试，请配置内网穿透。
