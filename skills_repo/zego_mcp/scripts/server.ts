import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import axios from 'axios';

// Node.js 环境下补充 EventSource Polyfill
import { EventSource } from 'eventsource';
(global as any).EventSource = EventSource;

const app = express();
app.use(cors());
app.use(bodyParser.json());

let mcpClient: Client | null = null;

/**
 * 核心逻辑：利用原生 HTTP 模拟 MCP 握手流程
 */
async function callZegoMcp(query: string) {
    const url = 'https://doc-ai.zego.im/mcp/';
    
    // 1. GET 握手获取 SID 
    // 官方服务器可能因为 User-Agent 或 握手顺序返回 400，但 Header 里依然会给 SID。
    // 我们需要强制 axios 接收这个“错误”响应。
    console.log('[ZegoMcpProxy] 正在从官方获取 Session ID...');
    let sid = '';
    try {
        const handshake = await axios.get(url, {
            headers: { 'Accept': 'text/event-stream' },
            timeout: 5000,
            validateStatus: () => true // 强制接受所有状态码
        });
        sid = handshake.headers['mcp-session-id'];
    } catch (e: any) {
        sid = e.response?.headers?.['mcp-session-id'];
    }
    
    if (!sid) throw new Error('Failed to get mcp-session-id from ZEGO');
    console.log(`[ZegoMcpProxy] 握手成功, SID: ${sid}`);

    const commonHeaders = {
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'Content-Type': 'application/json'
    };

    // 2. Initialize
    console.log('[ZegoMcpProxy] Initializing...');
    await axios.post(url, {
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'openclaw-proxy', version: '1.0.0' }
        }
    }, { headers: commonHeaders, validateStatus: () => true });

    // 3. Call Tool (search_zego_docs)
    console.log(`[ZegoMcpProxy] 执行搜索: ${query}`);
    const response = await axios.post(url, {
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: {
            name: 'search_zego_docs',
            arguments: {
                query: query,
                dataset_ids: ["319e6ea2960a11f0869376185b8a64f0"] // AI Agent Server ID
            }
        }
    }, { 
        headers: commonHeaders,
        responseType: 'text',
        validateStatus: () => true 
    });

    // 4. 解析 SSE 数据
    const text = response.data;
    if (typeof text === 'string') {
        const match = text.match(/data: (\{.*\})/);
        if (match) {
            try {
                return JSON.parse(match[1]);
            } catch(e) {}
        }
    }
    return text;
}

app.post('/search', async (req, res) => {
    const query = req.body.query || '';
    if (!query) return res.status(400).send("Missing query");

    try {
        const result = await callZegoMcp(query);
        res.status(200).send(JSON.stringify(result, null, 2));
    } catch (err: any) {
        console.error('[ZegoMcpProxy] 执行失败:', err.message);
        res.status(200).send("检索失败，ZEGO MCP 目前连接不稳定: " + err.message);
    }
});


const PORT = 3004;
app.listen(PORT, () => {
    console.log(`[ZegoMcpProxy] 知识引擎中继服务已启动，监听端口: ${PORT}`);
    console.log(`[ZegoMcpProxy] 即将为 OpenClaw V3.5 技能挂载注入真实 MCP 能量！\n`);
});
