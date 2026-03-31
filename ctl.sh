#!/bin/bash

# [V3.3.0] OpenClaw Voice Plugin 集中控制脚本 (CTL)

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

stop_services() {
    echo -e "${BLUE}🛑 正在关闭宿主机服务...${NC}"
    # 停止后端 Gateway
    pkill -f "ts-node scripts/dev-server.ts" && echo -e "${GREEN}✔ Backend 已停止${NC}" || echo "Backend 未运行"
    # 停止前端 UI (Vite)
    pkill -f "vite" && echo -e "${GREEN}✔ Frontend 已停止${NC}" || echo "Frontend 未运行"
    # 清理残留的验证脚本
    pkill -f "ts-node scripts/verify_" && echo -e "${GREEN}✔ 僵尸验证脚本已清理${NC}" || echo "无残留验证脚本"
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

clear_state() {
    echo -e "${BLUE}🧹 正在执行环境深度清理...${NC}"
    # 路径基于 ctl.sh 所在的 openclaw-voice-gateway 目录
    WORKSPACE_DIR="../openclaw-test-env/workspace"
    if [ -d "$WORKSPACE_DIR" ]; then
        rm -rf "$WORKSPACE_DIR/memory"/*
        rm -rf "$WORKSPACE_DIR/states"/*
        rm -rf "$WORKSPACE_DIR/logs"/*
        echo -e "${GREEN}✔ 磁盘历史状态已清空${NC}"
    else
        echo "未找到测试工作区: $WORKSPACE_DIR"
    fi

    # 清理本地日志与持久化记忆
    rm -f .backend.log .frontend.log .llm_requests.log
    rm -rf memory/*
    echo -e "${GREEN}✔ 本地日志与插件记忆已清空${NC}"
}

case "$1" in
    stop)
        stop_services
        echo -e "${BLUE}🐋 正在关闭 Docker 容器环境...${NC}"
        docker stop openclaw_voice_test > /dev/null 2>&1 && echo -e "${GREEN}✔ Docker 容器已关闭 (资源已释放)${NC}" || echo "Docker 容器未运行"
        ;;
    clear)
        clear_state
        ;;
    dev)
        echo -e "${BLUE}🧑‍💻 进入极速开发模式 (Host-side Simulation)...${NC}"
        stop_services
        # 确保容器运行 (用于提供 Mock 基础环境和工具链通路)
        docker start openclaw_voice_test > /dev/null 2>&1
        # 杀掉容器内的 openclaw 逻辑，由宿主机 Gateway 接管
        docker exec openclaw_voice_test pkill openclaw > /dev/null 2>&1
        
        npx tsc --noEmit || { echo -e "${RED}✘ 编译失败，启动中止${NC}"; exit 1; }
        
        # 注入 MOCK 标识 (由 executor 识别)
        export OPENCLAW_MOCK=true
        start_services
        ;;
    start|restart|"")
        echo -e "${BLUE}🚀 进入正式验证模式 (Full E2E Container)...${NC}"
        stop_services
        clear_state
        # 编译校验
        npx tsc --noEmit || { echo -e "${RED}✘ 编译失败，启动中止${NC}"; exit 1; }
        # 重启容器 (会拉起容器内原生 Agent 逻辑)
        docker restart openclaw_voice_test && echo -e "${GREEN}✔ Docker 容器环境已物理重置并自动拉起服务${NC}"
        
        # 确保非 MOCK 模式，连接容器内的真实 openClaw
        export OPENCLAW_MOCK=false
        start_services
        ;;
    "test")
        # 为 P0 脚本提供的对齐指令，由 scripts/verify_p0_regression.ts 调用
        ./ctl.sh restart
        ;;
    *)
        echo "使用方法: $0 [dev|restart|stop|clear|test]"
        exit 1
        ;;
esac
