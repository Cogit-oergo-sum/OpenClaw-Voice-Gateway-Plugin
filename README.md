# ZEGO-RealTimeAIAgent-3.0 (实时语音 AI Agent)

这是一个**生产级**实时语音 AI Agent 网关，可独立运行或与 [OpenClaw](https://github.com/openclaw/openclaw) 集成。

## 🌟 V4.0 核心特性：解耦架构

V4.0 完成深度解耦，openClaw 成为**可选插件**而非核心依赖：

- **工具后端抽象**：支持 Mock、openClaw Docker、HTTP、MCP 等多种工具执行方式
- **记忆同步插件**：对话记录和人设文件可双向同步到外部系统
- **统一模式控制**：通过 `VOICE_GATEWAY_MODE` 环境变量一键切换运行模式

---

## 🚀 快速启动

### 1. 安装与编译

```bash
cd openclaw-voice-gateway
npm install
npm run build
```

### 2. 设置环境变量

```bash
# 选择运行模式（推荐使用 standalone）
export VOICE_GATEWAY_MODE=standalone

# LLM API Key（已在 .env 中配置，无需额外设置）
# 如果需要修改，可编辑 .env 文件或设置以下环境变量：
# export BAILIAN_API_KEY=your-api-key
# export BAILIAN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```

> **注意**: 项目默认使用百炼（Bailian）作为 LLM provider，API Key 等配置已在 `.env` 文件中预设。

### 3. 一键启动

```bash
./ctl.sh restart
```

启动后访问：
- **后端 API**: http://localhost:18795
- **交互面板**: http://localhost:5173

### 4. 停止服务

```bash
./ctl.sh stop
```

---

## ⚙️ 运行模式配置

### 环境变量：`VOICE_GATEWAY_MODE`

| 模式 | 说明 | 工具后端 | 记忆同步 | 需要 Docker | 适用场景 |
|------|------|----------|----------|-------------|----------|
| `standalone` | **独立模式（默认）** | Mock | 本地文件 | ❌ | 演示、测试、无 openClaw 环境 |
| `openclaw` | openClaw 集成模式 | Docker | openClaw workspace | ✅ | 生产环境、已有 openClaw 部署 |
| `mock` | 开发调试模式 | Mock | 本地文件 | ❌ | UI/逻辑调试、CI 测试 |
| `http` | HTTP Backend 模式 | HTTP | 本地文件 | ❌ | 集成第三方工具服务 |

### 模式使用示例

```bash
# 1. 独立运行（最简单，推荐）- 只需设置模式，LLM 配置已在 .env 中
export VOICE_GATEWAY_MODE=standalone
./ctl.sh restart

# 2. openClaw 集成（生产环境）
export VOICE_GATEWAY_MODE=openclaw
export OPENCLAW_DOCKER_CONTAINER=openclaw_voice_test
# 需要运行 Docker 容器

# 3. 开发调试（极速响应）
export VOICE_GATEWAY_MODE=mock
./ctl.sh restart

# 4. HTTP Backend（集成外部服务）
export VOICE_GATEWAY_MODE=http
export VOICE_GATEWAY_HTTP_ENDPOINT=https://your-tool-service.com/api/execute
```

### 完整环境变量速查表

```
核心模式控制（推荐）：
┌─────────────────────────────────────────────────────────────────┐
│ VOICE_GATEWAY_MODE = standalone | openclaw | mock | http        │
└─────────────────────────────────────────────────────────────────┘

路径配置（可选，会自动使用默认值）：
  VOICE_GATEWAY_WORKSPACE    workspace 路径（所有模式）

HTTP 模式专用：
  VOICE_GATEWAY_HTTP_ENDPOINT    工具服务 endpoint URL

openClaw 模式专用：
  OPENCLAW_DOCKER_CONTAINER      Docker 容器名（默认: openclaw_voice_test）

LLM 配置（已在 .env 中预设）：
  BAILIAN_API_KEY                百炼 API Key（默认 provider）
  BAILIAN_BASE_URL               百炼 API 地址
  BAILIAN_MODEL                  默认模型
  SLC_MODEL                      SLC 极速响应模型（默认: qwen-flash-character）
  SLE_MODEL                      SLE 逻辑推理模型（默认: qwen-plus）
  ROUTER_MODEL                   IntentRouter 模型（默认: qwen-turbo）

向后兼容（旧环境变量仍有效）：
  OPENCLAW_PROFILE               workspace 路径（openclaw 模式）
  OPENCLAW_WORKSPACE             workspace 路径（openclaw 模式）
  OPENCLAW_MOCK=true             等同于 VOICE_GATEWAY_MODE=mock
```

---

## 📁 人设文件配置

### Workspace 目录结构

在 `standalone` 或 `mock` 模式下，人设文件放在 **workspace 目录**：

```
workspace/
├── soul.md          # AI 人设定义（必需）- 定义 Agent 的性格、语气、称呼
├── user.md          # 用户信息（推荐）- 定义用户的姓名、偏好、背景
├── AGENTS.md        # Agent 行为准则（可选）- 工具使用规则、交互规范
├── IDENTITY.md      # 身份定义（可选）- Agent 的身份、职责
├── memory.md        # 记忆配置（可选）- 长期记忆条目
└── memory/          # 对话记录目录（自动生成）
    └── 2026-04-17.jsonl
```

### 默认 Workspace 位置

| 模式 | 默认路径 |
|------|----------|
| `standalone` | `./workspace/`（当前目录下） |
| `mock` | `./workspace/` |
| `openclaw` | `~/.openclaw/workspace/` |

可通过环境变量覆盖：
```bash
export VOICE_GATEWAY_WORKSPACE=/your/custom/path
```

### 人设文件示例

#### `soul.md` - AI 人设定义

```markdown
# Jarvis Soul

你是 Jarvis，一位优雅、机智的智能助理。

## 核心特质
- 语气：温和、专业、略带幽默
- 称呼用户为"先生"或"女士"
- 风格：优雅管家、快速响应、主动关怀

## 行为准则
- 极速响应，不拖泥带水
- 遇到不确定时，主动询问澄清
- 任务完成后，简洁播报结果

## 禁止事项
- 不要过度道歉
- 不要复读用户的话
- 不要在播报中使用 Markdown 格式
```

#### `user.md` - 用户信息

```markdown
# User Profile

姓名：张先生

## 背景
- 职业：科技公司高管
- 常用语言：中文
- 时区：UTC+8（深圳）

## 偏好
- 简洁直接的回复风格
- 不喜欢过多寒暄
- 关注：日程管理、天气、新闻摘要
```

#### `AGENTS.md` - 工具使用规则

```markdown
# Agent Behavior Guidelines

## 工具调用规范
- 长耗时任务（>2秒）：使用 delegate_task 工具委派后台执行
- ASR 纠错：识别到发音歧义时，静默纠正

## 播报规范
- 任务进行中：简洁垫词（"稍等"、"正在处理"）
- 任务完成：直接报告结果，不重复过程
```

### 快速初始化 Workspace

```bash
# 创建 workspace 目录结构
mkdir -p workspace/memory

# 创建默认人设文件
cat > workspace/soul.md << 'EOF'
# AI Assistant Soul

你是一个智能助理。

风格：简洁、专业、友好
称呼用户：先生/女士
EOF

cat > workspace/user.md << 'EOF'
# User Profile

姓名：用户
EOF
```

---

## 🧪 测试与验证

### P0 回归测试

```bash
./ctl.sh test
```

### 模块单元验证

```bash
npx ts-node scripts/verify-s2-intent-router.ts
npx ts-node scripts/verify-s3-result-summarizer.ts
```

### 日志监控

```bash
# Canvas 状态日志
tail -f logs/canvas.jsonl

# 对话历史
tail -f memory/$(date +%Y-%m-%d).jsonl
```

---

## 🎮 前端交互面板

配套的 React 交互面板用于体感测试：

```bash
cd web
npm install
npm run dev
```

访问 http://localhost:5173

> **注意**: 为正常使用麦克风，请在 `localhost` 或配置好 `HTTPS` 的环境下访问。

---

## 🏗️ 核心架构

### Fast Agent V3 (Atomic Modular Architecture)

```
┌─────────────────────────────────────────────────────────────┐
│                      FastAgentV3                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │   SLC       │  │    SLE      │  │    Core Infra       │  │
│  │ (极速响应)  │  │ (逻辑推理)  │  │ CanvasManager       │  │
│  │  TTFT<600ms │  │ IntentRouter│  │ DialogueMemory      │  │
│  │             │  │ ToolHandler │  │ PromptAssembler     │  │
│  └─────────────┘  └─────────────┘  │ WatchdogService     │  │
│                                    └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### V4.0 插件化架构

```
┌─────────────────────────────────────────────────────────────┐
│                    ToolBackend 抽象层                        │
│  ┌──────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────┐ │
│  │MockBackend│  │OpenClawDocker│  │HttpBackend│  │MCP(未来)│ │
│  └──────────┘  └──────────────┘  └──────────┘  └─────────┘ │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                  MemorySyncPlugin 插件层                     │
│  ┌──────────────────┐  ┌─────────────────────────────────┐  │
│  │LocalFileSyncPlugin│  │OpenClawMemorySyncPlugin(可选)   │  │
│  └──────────────────┘  └─────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## 📖 核心文档参考

- 主设计方案: `doc/design/v3/fast_agent_v3.md`
- V3.3 重构: `doc/design/v3.3/v3.3_refactor_plan.md`
- V3.4 演进: `doc/design/v3.4/v3.4.md`
- V4.0 解耦: `doc/design/v4/v4.0_decoupling.md`

---

## 🔧 开发约束

1. **单文件行数限制**: 逻辑模块 ≤ 150 行，Facade ≤ 260 行
2. **职责单一**: 严禁在 `SLEEngine` 中直接操作文件或拼装复杂 Prompt
3. **Prompt 脚离**: 所有系统级 Prompt 必须定义在 `prompts.ts` 中
4. **消息分层**: 遵循 V3.6 System/User/History 三级角色分配原则
5. **场景隔离**: 严禁在 ROUTING 场景中注入 ACTION_PROTOCOL 或 ASR 纠错协议

---

## 📝 许可证

MIT License