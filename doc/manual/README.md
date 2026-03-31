# OpenClaw RTC 插件说明手册

欢迎使用 OpenClaw RTC 极速语音网关插件。为了方便开发者快速集成、定制与扩展此网关，我们按照不同场景组织了说明书内容。

## 📖 目录

### [01. 集成与使用基础指南](./01-integration.md)
*（待补充）*
- 介绍如何在 OpenClaw 项目中通过本地 link 挂载此插件
- 如何启动 Web 终端进行验证
- 各种通信端口及公网穿透 Tunnel 配置说明

### [02. 个性化配置与高阶开发 (Customization)](./02-customizing-agent.md)
- 👉 **如何深度魔改 Agent？** 变更系统的思考潜意识（Prompt）
- 👉 **如何按需扩展能力？** 为 SLE 引擎热插拔自定义 Skill（例如查询你的数据库、对接业务 API）
- 本地配置项（Config）微调

### [03. 运维及故障排查指引](./03-troubleshooting.md)
*（待补充）*
- 排查常见“全哑”、“已读不回”的原因
- ASR 热词防御机制说明
- Container 测试环境指南
