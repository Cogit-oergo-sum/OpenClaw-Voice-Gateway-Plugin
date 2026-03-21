#!/bin/bash

# [V3.3.0] OpenClaw Voice Plugin 集中控制脚本 (CTL)

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

stop_services() {
    echo -e "${BLUE}🛑 正在关闭所有服务...${NC}"
    pkill -f "ts-node scripts/dev-server.ts" && echo -e "${GREEN}✔ Backend 已停止${NC}" || echo "Backend 未运行"
    pkill -f "vite" && echo -e "${GREEN}✔ Frontend 已停止${NC}" || echo "Frontend 未运行"
}

start_services() {
    echo -e "${BLUE}🚀 正在启动 V3.3.0 原子化架构...${NC}"
    
    # 后端
    nohup npx ts-node scripts/dev-server.ts > .backend.log 2>&1 &
    sleep 2
    
    # 前端
    cd web
    nohup npm run dev > ../.frontend.log 2>&1 &
    cd ..
    
    echo -e "${GREEN}====================================${NC}"
    echo -e "🔗 Backend API: ${BLUE}http://localhost:18795${NC}"
    echo -e "🔗 Frontend UI: ${BLUE}http://localhost:5173${NC}"
    echo -e "💡 日志查看: ${BLUE}tail -f .backend.log${NC}"
    echo -e "${GREEN}====================================${NC}"
}

case "$1" in
    stop)
        stop_services
        ;;
    start|restart|"")
        stop_services
        # 编译校验
        npx tsc --noEmit || { echo -e "${RED}✘ 编译失败，启动中止${NC}"; exit 1; }
        start_services
        ;;
    *)
        echo "使用方法: $0 [start|stop|restart]"
        exit 1
        ;;
esac
