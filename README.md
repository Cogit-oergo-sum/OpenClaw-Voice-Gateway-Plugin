# OpenClaw Voice Gateway Plugin (语音网关插件)

这是一个为 [OpenClaw](https://github.com/openclaw/openclaw) 量身定制的**生产级**实时语音网关插件。
它利用 ZEGO (即构科技) 的大模型低延迟 RTC 链路，与 OpenClaw 强大的工作区和主 Agent 无缝对接。

## 🌟 核心突破：原子化模块架构 (v3.3.0)

本项目在 V3.3.0 中完成了深度重构，引入了 **Atomic Modular Architecture**，进一步优化了极低延迟表现与系统的可维护性：

- **组件化拆解 (Atomic Decoupling)**：
  - **IntentRouter**: 300ms 内完成意图分流，判定是否需要启动工具链。
  - **PromptAssembler**: 带有层级缓存的提示词组装器，彻底消除频繁读取 `soul.md` 的 IO 瓶颈。
  - **ResultSummarizer**: 专门负责高密度的任务结果提炼，确保画布（Canvas）摘要始终保持极高质量。
  - **DialogueMemory**: 事务级 WAL（Write-Ahead Logging）持久化，支持 100% 恢复会话上下文。
- **Canvas 状态机协议**：通过 `ToolResultHandler` 统一管理 `PENDING` -> `READY` 的状态流转，杜绝状态冲突。
- **思考哨兵 (Watchdog)**：500ms 扫描频率，支持自动补位、心跳播报与冷场触发。

---

## 🚀 一、部署与一键启动

### 1. 编译与检查
进入 `openclaw-voice-gateway` 目录：
```bash
npm install
npm run build   # 或 npx tsc --noEmit (仅检查)
```

### 2. 一键启动 (Backend + UI) 🌟
为了方便开发及调试，我们提供了一个合并启动脚本 `ctl.sh`：
```bash
./ctl.sh restart
```
*   **后端 API**: [http://localhost:18795](http://localhost:18795)
*   **主交互地址**: [http://localhost:5173](http://localhost:5173) (推荐)

### 3. 停止所有服务
```bash
./ctl.sh stop
```

---

## 🧪 二、多维度验证

### 1. 模块单元验证 (S-Stages)
针对 V3.3 的原子模块，我们提供了专门的验证脚本：
```bash
npx ts-node scripts/verify-s2-intent-router.ts
npx ts-node scripts/verify-s3-result-summarizer.ts
```

### 2. 全链路日志审计
重构后的系统对可观察性有极高要求，建议实时观察：
- **Canvas 日志**: `tail -f ../openclaw-test-env/workspace/logs/canvas.jsonl`
- **对话历史**: `tail -f ../openclaw-test-env/workspace/memory/yyyy-mm-dd.jsonl`

---

## 🎮 三、视觉化交互体验 (React + Vite) 🌟

为了获得最佳的体感测试，推荐使用配套的 React 交互面板。

### 1. 启动前端沙盒
```bash
cd web
npm install
npm run dev
```

### 2. 访问地址
- **主交互地址**: [http://localhost:5173](http://localhost:5173) (推荐，支持热更新与高级调试)
- **备用地址**: [http://localhost:18795/index.html](http://localhost:18795/index.html) (Dev Server 自带的轻量级预览)

### ⚠️ 运行提示
1. **浏览器限制**: 为正常使用麦克风，请务必在 `localhost` 或配置好 `HTTPS` 的环境下访问。
2. **连接配置**: 确保前端代理指向后端所在的 `18795` 端口。

