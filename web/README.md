# OpenClaw Voice Gateway Web Client

> **现代化、信令驱动的音视频通话 UI 终端**。
> 基于 React + TypeScript + Vite + TailwindCSS 构建。

---

## ✨ 核心特性

- **极致视觉复刻**: 1:1 复刻 `doc/promo_prototype.html` 中的深空极光背景与流体核心球。
- **实时信令驱动**: 深度集成 ZEGO Web SDK 的实验性接口，通过房间通道消息驱动 UI 状态转换（ASR 字幕/LLM 字幕）。
- **打字机动画**: 模拟真实人类语速的流式字符输出。
- **毛玻璃 UI (Glassmorphism)**: 优雅展示 Webhook 执行状态与内存同步进度（当前为前端 Mock 序列）。

## 🚀 快速启动

1. **安装依赖**:
   ```bash
   npm install
   ```

2. **本地开发**:
   ```bash
   npm run dev
   ```

3. **构建产物**:
   ```bash
   npm run build
   ```

4. **部署到 Vercel**:
   ```bash
   # 安装 Vercel CLI（首次使用）
   npm install -g vercel
   
   # 配置生产环境后端地址（可选，默认 localhost:18795）
   echo "VITE_GATEWAY_URL=https://your-backend.com" > .env.production
   
   # 部署
   vercel --prod
   ```

## 🌐 Vercel 部署

### 前置条件

由于前端需要连接后端 API (`/voice/*`, `/chat/*`, `/hooks/*`)，您需要确保后端可公网访问：

**方案 A: 内网穿透（测试用）**
```bash
# 使用 ngrok
ngrok http 18795
# 获取地址如：https://abc123.ngrok.io

# 部署时设置环境变量
vercel --env VITE_GATEWAY_URL=https://abc123.ngrok.io
```

**方案 B: 云服务器部署后端**
- 将后端部署到有公网 IP 的服务器
- 或使用 Vercel/其他云平台部署后端 API

**方案 C: Vercel 环境变量**
1. 在 Vercel Dashboard → Project Settings → Environment Variables
2. 添加 `VITE_GATEWAY_URL` = 您的后端地址
3. 重新部署

## 🛠️ 技术细节

- **核心 Hook**: `src/hooks/useAgent.ts` 负责与本插件后台 (/voice/start-call) 换取 Token，并注册 ZEGO 房间监听回调。
- **组件化**: 
  - `FluidVoiceCore`: 流体三层球体，根据 IDLE/LISTENING/SPEAKING 切换 CSS Class。
  - `SubtitleStream`: 基于 `framer-motion` 实现的堆叠字幕，具备旧语淡出模糊效果。
  - `AuroraBackground`: 硬件加速的背景动态气泡。

## ⚠️ 注意事项

- **麦克风权限**: 浏览器仅允许在 `localhost` 或 `HTTPS` 环境下调起麦克风。
- **网关地址**: 
  - 本地开发：默认 `http://localhost:18795`
  - 生产环境：通过环境变量 `VITE_GATEWAY_URL` 配置
  - 修改位置：`src/hooks/useAgent.ts` 或使用 `.env.production` 文件
