#!/bin/bash

# ============================================
# Vercel 自动同步配置脚本
# ============================================
# 用途：快速配置后端 Vercel 自动同步功能
# ============================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$SCRIPT_DIR/.env"

echo "🔧 Vercel 自动同步配置脚本"
echo "============================================"
echo ""

# 检查 .env 文件是否存在
if [ ! -f "$ENV_FILE" ]; then
    echo "❌ .env 文件不存在：$ENV_FILE"
    exit 1
fi

echo "📍 .env 文件位置：$ENV_FILE"
echo ""

# 获取 Vercel Token
echo "🔑 请输入 Vercel Token："
echo "   获取地址：https://vercel.com/account/tokens"
read -p "> " VERCEL_TOKEN

if [ -z "$VERCEL_TOKEN" ]; then
    echo "❌ Token 不能为空"
    exit 1
fi

echo ""

# 获取 Vercel Project ID
echo "📁 请输入 Vercel Project ID："
echo "   获取方式：Vercel Dashboard → Settings → General → Project ID"
echo "   格式如：prj_xxxxxxxxxxxxxxx"
read -p "> " VERCEL_PROJECT_ID

if [ -z "$VERCEL_PROJECT_ID" ]; then
    echo "❌ Project ID 不能为空"
    exit 1
fi

echo ""

# 备份现有 .env 文件
BACKUP_FILE="$ENV_FILE.backup.$(date +%Y%m%d_%H%M%S)"
cp "$ENV_FILE" "$BACKUP_FILE"
echo "💾 已备份现有配置：$BACKUP_FILE"
echo ""

# 检查是否已存在 Vercel 配置
if grep -q "^VERCEL_TOKEN=" "$ENV_FILE"; then
    # 更新现有配置
    sed -i.bak "s|^VERCEL_TOKEN=.*|VERCEL_TOKEN=$VERCEL_TOKEN|" "$ENV_FILE"
    sed -i.bak "s|^VERCEL_PROJECT_ID=.*|VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID|" "$ENV_FILE"
    rm -f "$ENV_FILE.bak"
    echo "✅ 已更新 Vercel 配置"
else
    # 追加新配置
    cat >> "$ENV_FILE" << EOF

# ===========================================
# Vercel 自动同步配置
# ===========================================
VERCEL_TOKEN=$VERCEL_TOKEN
VERCEL_PROJECT_ID=$VERCEL_PROJECT_ID
EOF
    echo "✅ 已添加 Vercel 配置"
fi

echo ""
echo "============================================"
echo "✅ 配置完成！"
echo ""
echo "📋 下一步操作："
echo ""
echo "1️⃣  重启后端服务以应用配置："
echo "   pm2 restart voice-gateway"
echo "   或"
echo "   node dist/index.js"
echo ""
echo "2️⃣  首次手动部署前端："
echo "   cd $SCRIPT_DIR/web"
echo "   vercel --prod"
echo ""
echo "3️⃣  测试自动同步："
echo "   - 重启 Pinggy 隧道"
echo "   - 查看后端日志确认同步成功"
echo "   - 访问 Vercel 部署的前端测试"
echo ""
echo "📖 详细文档：$SCRIPT_DIR/VERCEL_AUTO_SYNC.md"
echo "============================================"
echo ""

# 验证配置（可选）
read -p "是否现在验证 Vercel Token？(y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🔍 验证 Vercel Token..."
    
    RESPONSE=$(curl -s -w "\n%{http_code}" \
        -H "Authorization: Bearer $VERCEL_TOKEN" \
        "https://api.vercel.com/v1/user")
    
    HTTP_CODE=$(echo "$RESPONSE" | tail -n1)
    BODY=$(echo "$RESPONSE" | head -n-1)
    
    if [ "$HTTP_CODE" = "200" ]; then
        USER_NAME=$(echo "$BODY" | grep -o '"username":"[^"]*"' | cut -d'"' -f4)
        echo "✅ Token 有效！"
        echo "   用户：$USER_NAME"
    else
        echo "❌ Token 验证失败 (HTTP $HTTP_CODE)"
        echo "   请检查 Token 是否正确"
        echo "   响应：$BODY"
    fi
fi

echo ""
echo "🎉 配置脚本执行完毕！"
