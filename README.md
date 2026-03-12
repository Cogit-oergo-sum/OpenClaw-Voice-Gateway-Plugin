# OpenClaw Voice Gateway Plugin (语音网关插件)

这是一个为 [OpenClaw](https://github.com/openclaw/openclaw) 量身定制的**生产级**实时语音网关插件。
它利用 ZEGO (即构科技) 的大模型低延迟 RTC 链路，与 OpenClaw 强大的工作区和主 Agent 无缝对接。此项目实现了语音打断、SSE 垫话破 900ms 物理超时、崩溃自动扫雷、断网超时熔断等深水区防御机制。

如果你是在全新的 OpenClaw 电脑上部署，请**严格按照以下四大步骤顺序操作**。

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
- **【方式 A（推荐调试）】**：使用 OpenClaw 命令行将本地路径 link 为插件包：
  ```bash
  openclaw plugin link /绝对路径/voice-gateway
  ```
- **【方式 B（生产部署）】**：直接把整个 `voice-gateway` 文件夹拖入你的 OpenClaw 实例的 `plugins/` 挂载目录中（如果是 Docker 部署，请将其放入映射的 plugin 路径下）。

重启 OpenClaw 主控程序，当看到日志打印 `VoiceGateway Plugin routes registered successfully` 时，代表插件已成功点火登舱！

---

## ⚙️ 二、核心配置 (配置文件到底写在哪？)

本插件内的 `config.schema.json` **不用于存储你的真实密码！** 它只是一份“表单结构定义”。OpenClaw 的前端面板会读取这个 Schema，为你自动生成一个配置输入框。

### 落盘方式：
如果你没有通过 OpenClaw 的网页 UI 可视化填写，你想用纯后端文件下发，请**在这个插件的根目录（或 OpenClaw 要求的 plugin storage 目录）新建一个名为 `config.json` 的文件**，并按照以下格式填入你真实的明文 Key：

```json
{
  "zego": {
    "appId": 123456789,
    "serverSecret": "你从ZEGO控制台获取的32位字符串",
    "aiAgentBaseUrl": "https://aigc-aiagent-api.zegotech.cn"
  },
  "llm": {
    "provider": "volcengine",      
    "apiKey": "sk-your-llm-api-key",
    "model": "doubao-lite-32k",
    "baseUrl": "https://ark.cn-beijing.volces.com/api/v3"
  },
  "tts": {
    "vendor": "ByteDance",
    "appId": "volcengine-app-id",
    "token": "volcengine-token",
    "voiceType": "zh_female_wanwanxiaohe_moon_bigtts"
  }
}
```
*注：一旦配置保存成功，OpenClaw 会将这些参数注入并回传给插件根目录的 `index.ts` 中的 `register(api, config)` 方法。*

---

## 🔗 三、打破硬编码：网络环境与端口排雷

在默认代码中，我们假定了 OpenClaw 的 Webhook API 在默认端口 `18789` 监听。如果你的电脑 18789 端口被占用，或者你的 OpenClaw 配了反向代理，**你必须修改两处硬编码网络地址**，否则系统会熔断停摆！

### 排雷点 1 (后端 Webhook 的指向)：
当网关触发 `delegate_openclaw` 时，需要向主 Agent 汇报意图。打开本插件的 `src/http/chat-api.ts`：
```typescript
// 找到这行并将其改为你真实的 OpenClaw 监听地址和端口
const webhookUrl = 'http://localhost:18789/hooks/agent'; 
```
*（修改后记得重新跑一次 `npm run build`）*

### 排雷点 2 (前端测试页的网关指针)：
用于本地调测的 Web 客户端固定了网关坐标。如果你的网关不是运行在 `18789`，请打开 `web/src/hooks/useAgent.ts` 修改：
```typescript
const GATEWAY_URL = 'http://localhost:18789'; 
```

---

## 🎮 四、一键沙盒跑测！(React + Vite 版)

本插件配套了一套极具视觉冲击力的 React Web 客户端，支持流式字幕展示和状态联动。

### 1. 启动 Web 终端
```bash
cd web
npm install
npm run dev
```
接着在浏览器打开控制台打印的地址（通常是 `http://localhost:5173`）。

### 2. 交互逻辑
*   **点击屏幕**：发起语音通话（换取 Token 并建立 RTC 连接）。
*   **流式信令驱动**：页面视觉球（FluidVoiceCore）的状态完全由 ZEGO AI Agent 的底层信令驱动（ Cmd 3/4 触发）。
*   **模拟能力**：Webhook 组件（发邮件等场景）由前端 Mock 序列自动触发演示。

### ⚠️ 致命警告：局域网/手机跨设备测试的 HTTPS 限制！
**如果试图用手机扫码、或在公司局域网用另外一台电脑通过 IP 来访问这个测试页，麦克风将绝对无法唤醒！**

这是由于现代浏览器安全策略导致的：`navigator.mediaDevices.getUserMedia` **只能**在 `localhost` 或已部署 `HTTPS` 证书的环境下工作。如果必须要用手机局域网测试体验，请配置内网穿透（如 `ngrok http 5173`）。
