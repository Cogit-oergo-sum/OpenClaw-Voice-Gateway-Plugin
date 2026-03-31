# Vercel 自动同步配置指南

## 🎯 功能说明

后端 Tunnel Watcher 现已支持**双同步机制**：

1. ✅ **ZEGO Agent 注册** - 原有功能，每 45 秒自动检测并同步
2. 🆕 **Vercel 环境变量 + 自动部署** - 新增功能，隧道 URL 变化时自动触发

---

## 🔑 配置步骤

### 步骤 1: 获取 Vercel Token

1. 访问 https://vercel.com/account/tokens
2. 点击 **Create Token**
3. 选择 Scope（个人账号或团队）
4. 输入 Token 名称（如：`voice-gateway-auto-sync`）
5. 选择过期时间（建议 90 天或永不过期）
6. 复制生成的 Token（格式如：`<your_token_here>`）

### 步骤 2: 获取 Vercel Project ID

**方法 A: Vercel Dashboard**
1. 访问 https://vercel.com/dashboard
2. 进入您的项目
3. 点击 **Settings** → **General**
4. 找到 **Project ID**（格式如：`prj_xxxxxxxxxxxxxxx`）

**方法 B: Vercel CLI**
```bash
cd /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway/web
vercel link
# 然后查看 .vercel/project.json 中的 projectId
```

### 步骤 3: 配置环境变量

编辑后端 `.env` 文件：
```bash
# /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway/.env

VERCEL_TOKEN=your_vercel_token_here
VERCEL_PROJECT_ID=prj_xxxxxxxxxxxxxxx
```

### 步骤 4: 重启后端服务

```bash
# 如果使用 PM2
pm2 restart voice-gateway

# 或者直接重启 Node 进程
```

---

## 🔄 工作流程

```
┌─────────────────────────────────────────────────────────────┐
│  1. Pinggy 隧道重启/URL 变化                                  │
│     ↓                                                       │
│  2. Tunnel Watcher 检测到 /tmp/tunnel.log 变化（每 45 秒）        │
│     ↓                                                       │
│  3. 提取最新 Pinggy URL                                       │
│     ↓                                                       │
│  4a. 同步到 ZEGO Agent 注册（原有）                            │
│     ↓                                                       │
│  4b. 同步到 Vercel 环境变量（新增）                             │
│     ↓                                                       │
│  5. 触发 Vercel 自动重新部署（新增）                            │
│     ↓                                                       │
│  6. 前端自动使用新 API 地址                                     │
└─────────────────────────────────────────────────────────────┘
```

---

## 📊 日志示例

成功同步时，后端日志会显示：

```
[VoiceGateway] 🔄 Tunnel URL Shift Detected: https://old.pinggy.link -> https://new.pinggy.link
[VoiceGateway] ✅ ZEGO Sync Complete. New Callback URL: https://new.pinggy.link/voice-gateway/chat/completions
[VoiceGateway] 🔄 Syncing Vercel Environment: VITE_GATEWAY_URL=https://new.pinggy.link
[VoiceGateway] ✅ Vercel Environment Updated
[VoiceGateway] 🚀 Triggering Vercel Redeployment...
[VoiceGateway] ✅ Vercel Deployment Triggered: https://your-project.vercel.app
```

---

## ⚠️ 注意事项

### 1. Vercel 部署频率限制
- Vercel Hobby 计划：每月 100 次自动部署
- Pinggy 免费隧道：URL 通常在重启后变化
- **建议**：如果隧道频繁重启，考虑升级到 Cloudflare Tunnel（固定域名）

### 2. 部署延迟
- Vercel 部署通常需要 30-60 秒
- 在此期间，前端可能短暂不可用
- 建议在生产环境使用固定域名方案

### 3. 安全建议
- `VERCEL_TOKEN` 具有项目完全访问权限
- 不要将 `.env` 文件提交到 Git
- 定期轮换 Token

### 4. 故障排查

**问题：Vercel 同步失败**
```bash
# 检查 Token 是否有效
curl -H "Authorization: Bearer <your_token>" \
     https://api.vercel.com/v1/user

# 检查 Project ID 是否正确
curl -H "Authorization: Bearer <your_token>" \
     https://api.vercel.com/v10/projects/<your_project_id>
```

**问题：部署失败**
- 检查 Vercel Dashboard 的 Deployments 标签页
- 查看构建日志中的错误信息
- 确认 `main` 分支存在且可访问

---

## 🎯 首次部署流程

1. **配置环境变量**（如上）
2. **手动部署一次前端**：
   ```bash
   cd /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway/web
   vercel --prod
   ```
3. **启动后端服务**（确保 `.env` 已配置）
4. **等待自动同步**（或重启隧道测试）

---

## 🔧 手动触发同步（测试用）

```bash
# 运行手动同步脚本
cd /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway
npx ts-node scripts/fix-tunnel.ts
```

---

## 📈 后续优化建议

1. **添加部署状态回调** - Vercel 部署完成后通知后端
2. **健康检查端点** - 前端定期检查 API 可用性
3. **降级策略** - 自动同步失败时使用备用方案
4. **监控告警** - 同步失败时发送通知

---

**配置完成后，系统将全自动运行，无需人工干预。**

需要我帮您执行配置或测试吗，Sir？
