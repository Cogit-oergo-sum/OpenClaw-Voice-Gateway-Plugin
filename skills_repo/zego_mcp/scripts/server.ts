import express from 'express';
import bodyParser from 'body-parser';
import cors from 'cors';
import axios from 'axios';

// Node.js 环境下补充 EventSource Polyfill
import { EventSource } from 'eventsource';
(global as any).EventSource = EventSource;

const app = express();
app.use(cors());
app.use(bodyParser.json());

const MCP_URL = 'https://doc-ai.zego.im/mcp/';

/**
 * 通用 MCP 握手 + Tool 调用
 * 1. GET 握手获取 mcp-session-id
 * 2. POST initialize
 * 3. POST tools/call
 * 4. 解析 SSE 响应
 */
async function callZegoMcpTool(toolName: string, args: Record<string, any> = {}): Promise<any> {
    // 1. GET 握手获取 Session ID
    console.log(`[ZegoMcpProxy] 握手获取 Session ID (tool: ${toolName})...`);
    let sid = '';
    try {
        const handshake = await axios.get(MCP_URL, {
            headers: { 'Accept': 'text/event-stream' },
            timeout: 8000,
            validateStatus: () => true
        });
        sid = handshake.headers['mcp-session-id'];
    } catch (e: any) {
        sid = e.response?.headers?.['mcp-session-id'];
    }

    if (!sid) throw new Error('Failed to get mcp-session-id from ZEGO MCP server');
    console.log(`[ZegoMcpProxy] SID: ${sid}`);

    const headers = {
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sid,
        'Content-Type': 'application/json'
    };

    // 2. Initialize
    await axios.post(MCP_URL, {
        jsonrpc: '2.0', id: 1, method: 'initialize',
        params: {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'openclaw-proxy', version: '1.0.0' }
        }
    }, { headers, validateStatus: () => true });

    // 3. Call Tool
    console.log(`[ZegoMcpProxy] 调用 tool: ${toolName}`, JSON.stringify(args).slice(0, 200));
    const response = await axios.post(MCP_URL, {
        jsonrpc: '2.0', id: 2, method: 'tools/call',
        params: { name: toolName, arguments: args }
    }, {
        headers,
        responseType: 'text',
        validateStatus: () => true,
        timeout: 30000
    });

    // 4. 解析 SSE 数据
    const text = response.data;
    if (typeof text === 'string') {
        const match = text.match(/data: (\{.*\})/);
        if (match) {
            try {
                const parsed = JSON.parse(match[1]);
                // 提取 tool 结果文本
                const content = parsed?.result?.content;
                if (Array.isArray(content) && content[0]?.type === 'text') {
                    try { return JSON.parse(content[0].text); } catch { return content[0].text; }
                }
                return parsed?.result ?? parsed;
            } catch { /* fall through */ }
        }
    }
    return text;
}

/**
 * dataset_ids 自动解析：当未提供时，先获取产品列表，按 product 名称筛选
 */
async function resolveDatasetIds(product?: string): Promise<string[]> {
    if (!product) {
        // 无 product 提示时，使用 AI Agent 默认 dataset
        return ['319e6ea2960a11f0869376185b8a64f0'];
    }

    const products = await callZegoMcpTool('get_zego_product_datasets', {});
    let datasetList: any[] = [];

    // products 可能是数组或嵌套对象
    if (Array.isArray(products)) {
        const matched = products.find((p: any) => p.name === product);
        datasetList = matched?.datasets ?? [];
    }

    if (datasetList.length === 0) {
        console.warn(`[ZegoMcpProxy] 未找到产品 "${product}" 的 dataset，使用默认 AI Agent dataset`);
        return ['319e6ea2960a11f0869376185b8a64f0'];
    }

    return datasetList.map((d: any) => d.id);
}

// ============ Express 路由 ============

// POST /get_zego_product_datasets
app.post('/get_zego_product_datasets', async (_req, res) => {
    try {
        const result = await callZegoMcpTool('get_zego_product_datasets', {});
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] get_zego_product_datasets 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST /get_platforms_by_product  body: {product: string}
app.post('/get_platforms_by_product', async (req, res) => {
    const product = req.body.product;
    if (!product) return res.status(400).json({ error: 'Missing product' });

    try {
        const result = await callZegoMcpTool('get_platforms_by_product', { product });
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] get_platforms_by_product 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST /get_doc_links  body: {product: string, platform_index?: number}
app.post('/get_doc_links', async (req, res) => {
    const { product, platform_index } = req.body;
    if (!product) return res.status(400).json({ error: 'Missing product' });

    try {
        const args: Record<string, any> = { product };
        if (typeof platform_index === 'number') args.platform_index = platform_index;
        const result = await callZegoMcpTool('get_doc_links', args);
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] get_doc_links 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST /search_zego_docs  body: {query: string, dataset_ids?: string[], product?: string}
app.post('/search_zego_docs', async (req, res) => {
    const { query, product } = req.body;
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        let dataset_ids = req.body.dataset_ids;
        if (!Array.isArray(dataset_ids) || dataset_ids.length === 0) {
            dataset_ids = await resolveDatasetIds(product);
        }
        const result = await callZegoMcpTool('search_zego_docs', { query, dataset_ids });
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] search_zego_docs 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST /get_token_generate_doc  body: {language: string}
app.post('/get_token_generate_doc', async (req, res) => {
    const language = req.body.language || 'NODEJS';
    try {
        const result = await callZegoMcpTool('get_token_generate_doc', { language });
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] get_token_generate_doc 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// POST /get_server_signature_doc  body: {language: string}
app.post('/get_server_signature_doc', async (req, res) => {
    const language = req.body.language || 'NODEJS';
    try {
        const result = await callZegoMcpTool('get_server_signature_doc', { language });
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] get_server_signature_doc 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// [Legacy] 保留原 /search 路由向后兼容
app.post('/search', async (req, res) => {
    const query = req.body.query || '';
    if (!query) return res.status(400).json({ error: 'Missing query' });

    try {
        const result = await callZegoMcpTool('search_zego_docs', {
            query,
            dataset_ids: ['319e6ea2960a11f0869376185b8a64f0']
        });
        res.json(result);
    } catch (err: any) {
        console.error('[ZegoMcpProxy] /search 失败:', err.message);
        res.status(502).json({ error: err.message });
    }
});

// 健康检查
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const PORT = 3004;
app.listen(PORT, () => {
    console.log(`[ZegoMcpProxy] 知识引擎中继服务已启动，监听端口: ${PORT}`);
    console.log(`[ZegoMcpProxy] 支持路由: /get_zego_product_datasets, /get_platforms_by_product, /get_doc_links, /search_zego_docs, /get_token_generate_doc, /get_server_signature_doc, /search (legacy)`);
});
