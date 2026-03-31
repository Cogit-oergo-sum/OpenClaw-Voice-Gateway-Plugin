# Vercel 部署快速指南

## ✅ 已完成的准备工作

1. ✅ 代码已支持环境变量 `VITE_GATEWAY_URL`
2. ✅ 创建 `vercel.json` 配置文件
3. ✅ 创建 `.env.example` 示例文件
4. ✅ 更新 `README.md` 部署说明
5. ✅ 添加 `npm run deploy` 脚本
6. ✅ **后端集成 Vercel 自动同步**（新增 🎉）

---

## 🚀 部署方案

### 方案 A：全自动同步（推荐）⭐

后端 Tunnel Watcher 已集成 Vercel API，当 Pinggy 隧道 URL 变化时：
- ✅ 自动更新 Vercel 环境变量
- ✅ 自动触发重新部署
- ✅ 无需人工干预

**配置步骤：**

1. **获取 Vercel 凭证**
   - Token: https://vercel.com/account/tokens
   - Project ID: Vercel Dashboard → Settings → General

2. **配置后端 `.env`**
   ```bash
   VERCEL_TOKEN=your_token_here
   VERCEL_PROJECT_ID=prj_xxxxx
   ```

3. **重启后端**
   ```bash
   pm2 restart voice-gateway
   # 或
   node dist/index.js
   ```

4. **首次手动部署前端**
   ```bash
   cd /Users/rhettbot/scratch/openClaw-RTC-plugin/openclaw-voice-gateway/web
   vercel --prod
   ```

**完成！** 之后每次隧道重启都会自动同步和部署。

📖 详细文档：`../VERCEL_AUTO_SYNC.md`

---

### 方案 B：手动同步（备选）

如果不想配置自动同步，可以手动操作：

```bash
# 1. 启动隧道
ssh -R 80:localhost:18795 okey.pinggy.io > /tmp/tunnel.log &

# 2. 获取 URL
TUNNEL_URL=$(grep -o 'https://[^"]*\.pinggy\.link' /tmp/tunnel.log | tail -1)

# 3. 更新 Vercel 并部署
vercel env add VITE_GATEWAY_URL $TUNNEL_URL production
vercel --prod
```

---

### 方案 C：固定域名（生产环境推荐）

使用 Cloudflare Tunnel 获得固定域名，避免频繁部署：

```bash
# 1. 安装 cloudflared
brew install cloudflared

# 2. 启动隧道
cloudflared tunnel --url http://localhost:18795

# 3. 获取固定域名并配置一次
vercel env add VITE_GATEWAY_URL https://your-fixed-domain.trycloudflare.com production
vercel --prod
```

---

## 🔧 环境变量配置

| 变量名 | 说明 | 示例 |
|--------|------|------|
| `VITE_GATEWAY_URL` | 后端 API 地址 | `https://abc123.ngrok.io` |

### 设置方式：

**方式 1: Vercel Dashboard**
1. 进入项目 → Settings → Environment Variables
2. 添加 `VITE_GATEWAY_URL`
3. 选择环境（Production）
4. 保存后重新部署

**方式 2: 命令行**
```bash
vercel env add VITE_GATEWAY_URL https://your-backend.com production
vercel --prod
```

**方式 3: 本地文件**
```bash
echo "VITE_GATEWAY_URL=https://your-backend.com" > .env.production
vercel --prod
```

---

## ⚠️ 常见问题

### 1. 部署后无法连接后端
- 检查 `VITE_GATEWAY_URL` 是否正确设置
- 确认后端服务正在运行
- 确认内网穿透隧道已启动

### 2. 麦克风权限错误
- Vercel 默认 HTTPS，符合浏览器要求
- 检查浏览器权限设置

### 3. CORS 错误
- 确保后端允许来自 Vercel 域名的跨域请求
- 后端需设置 `Access-Control-Allow-Origin: *` 或指定域名

### 4. ZEGO SDK 连接失败
- 检查 AppID `1623602215` 是否有效
- 确认网络环境可访问 ZEGO 服务

---

## 📊 持续部署

配置 GitHub 自动部署：

1. 将代码推送到 GitHub
2. 在 Vercel 导入项目
3. 连接 GitHub 仓库
4. 每次 push 到 main 分支自动部署

---

## 🎯 下一步建议

1. **短期**: 使用方案 A（全自动同步）快速测试
2. **中期**: 使用方案 C（Cloudflare Tunnel）获得固定域名
3. **长期**: 将后端部署到云服务器或 Vercel Serverless

---

**需要我帮您执行部署吗，Sir？**
