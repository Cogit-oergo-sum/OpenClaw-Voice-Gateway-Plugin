import express, { Request, Response } from 'express';
import bodyParser from 'body-parser';
import { register } from '../src/index';
import * as path from 'path';

/**
 * 这是一个极简的 OpenClaw 模拟宿主 (Dev Host Proxy)
 * 用于在没有安装完整 OpenClaw 的环境下，直接启动并测试 Voice Gateway 插件。
 */

import cors from 'cors';

const app = express();

// 1. 配置 CORS (确保在所有路由之前)
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

// 2. 配置 Body Parser
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

app.use((req, res, next) => {
    if (req.method !== 'OPTIONS') {
        console.log(`[HTTP] ${req.method} ${req.url}`);
    }
    next();
});

console.log(`[MockHost] Using OPENCLAW_WORKSPACE: ${process.env.OPENCLAW_WORKSPACE}`);

// 3. 模拟 OpenClaw 的 PluginAPI 接口
const mockApi = {
    registerHttpRoute: (options: { path: string; handler: (req: Request, res: Response) => void | Promise<void> }) => {
        const { path: routePath, handler } = options;
        console.log(`[MockHost] Registered Route: ${routePath}`);
        
        // 使用 .all 确保处理所有方法，但主要由插件逻辑决定
        app.all(routePath, async (req: Request, res: Response) => {
            try {
                if (req.method === 'OPTIONS') return res.sendStatus(200);
                
                // 兜底：确保 req.body 至少是一个空对象，防止 destructuring 崩溃
                if (!req.body) req.body = {};
                
                await handler(req, res);
            } catch (e: any) {
                console.error(`[MockHost] Error in Route ${routePath}:`, e);
                if (!res.headersSent) {
                    res.status(500).json({ error: e.message });
                }
            }
        });
    },
    registerTool: (options: any) => {
        console.log(`[MockHost] Registered Tool: ${options.name} - ${options.description}`);
    }
};

// 模拟 OpenClaw 注入的配置 (从 .env 或默认值中取)
const mockConfig = {
    zego: {
        appId: 0,
        serverSecret: '',
        aiAgentBaseUrl: 'http://localhost:18789'
    },
    llm: {
        provider: 'bailian',
        apiKey: process.env.BAILIAN_API_KEY || '',
        baseUrl: process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        model: process.env.BAILIAN_MODEL || 'qwen-plus'
    },
    tts: {
        vendor: 'mock',
        appId: '',
        token: '',
        voiceType: ''
    },
    asr: {
        vendor: 'mock'
    },
    advanced: {
        httpAuthToken: 'none'
    }
};

// 静态资源：托管 web_vanilla 目录，方便直接打开浏览器测试
app.use(express.static(path.join(__dirname, '../web_vanilla')));

// 核心：调用插件入口进行注册
console.log('[MockHost] Starting VoiceGateway Plugin in Simulation Mode...');
register(mockApi as any, mockConfig as any);

const PORT = 18790;
app.listen(PORT, () => {
    console.log(`
🚀 OpenClaw Plugin Mock Host started!
---------------------------------------------
测试入口: http://localhost:${PORT}/index.html
Webhook Callback: http://localhost:${PORT}/voice/mock-callback
Text Chat: http://localhost:${PORT}/voice/text-chat
---------------------------------------------
请确保您已经在 .env 中配置了 BAILIAN_API_KEY。
`);
});
