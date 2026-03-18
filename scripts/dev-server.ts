import express from 'express';
import cors from 'cors';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { register } from '../src/index';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// 记录所有请求
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

// 模拟 PluginAPI
const api = {
    registerHttpRoute: (options: any) => {
        const method = (options.match || 'POST').toLowerCase();
        app[method as 'get' | 'post'](options.path, async (req, res, next) => {
            try {
                await options.handler(req, res);
            } catch (err) {
                next(err);
            }
        });
        console.log(`Registered Route: ${method.toUpperCase()} ${options.path}`);
    },
    registerTool: (options: any) => {
        console.log(`Registered Tool: ${options.name}`);
    }
};

const config = {
    zego: {
        appId: Number(process.env.ZEGO_APP_ID),
        serverSecret: process.env.ZEGO_SERVER_SECRET,
        aiAgentBaseUrl: process.env.ZEGO_AI_AGENT_BASE_URL
    },
    llm: { 
        provider: "bailian", 
        apiKey: process.env.BAILIAN_API_KEY, 
        model: process.env.BAILIAN_MODEL || 'qwen-plus',
        baseUrl: process.env.BAILIAN_BASE_URL
    },
    tts: { vendor: "ByteDance", appId: "zego_test", token: "zego_test", voiceType: "zh_female_wanwanxiaohe_moon_bigtts" },
    advanced: { httpAuthToken: "none" },
    fastAgent: {
        slcModel: process.env.SLC_MODEL || 'qwen-turbo',
        slcBaseUrl: process.env.SLC_BASE_URL || process.env.BAILIAN_BASE_URL,
        sleModel: process.env.BAILIAN_MODEL || 'qwen-plus',
        sleBaseUrl: process.env.BAILIAN_BASE_URL
    }
};

// 注册插件路由
register(api, config as any);

// 提供静态文件服务 (web_vanilla)
const staticDir = path.join(__dirname, '../web_vanilla');
app.use(express.static(staticDir));
console.log(`Serving static files from: ${staticDir}`);

const PORT = 18795;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\x1b[32m[Success] Web Simulation running at http://localhost:${PORT}\x1b[0m`);
    console.log(`\x1b[36m[Info] You can now use the browser to experience Fast Agent interaction.\x1b[0m`);
});
