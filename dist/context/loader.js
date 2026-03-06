"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWorkspacePath = resolveWorkspacePath;
exports.readWorkspaceFile = readWorkspaceFile;
exports.writeWorkspaceJson = writeWorkspaceJson;
exports.appendWorkspaceFile = appendWorkspaceFile;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
/**
 * 确定 OpenClaw Workspace 的根目录路径
 * 优先级: 传入配置 -> 环境变量 OPENCLAW_PROFILE -> 默认 ~/.openclaw/workspace/
 */
function resolveWorkspacePath(configProfilePath) {
    if (configProfilePath) {
        return path.resolve(configProfilePath);
    }
    if (process.env.OPENCLAW_PROFILE) {
        return path.resolve(process.env.OPENCLAW_PROFILE);
    }
    return path.join(os.homedir(), '.openclaw', 'workspace');
}
/**
 * 安全地读取 Workspace 下的某个文件内容
 */
async function readWorkspaceFile(workspace, relativePath) {
    const fullPath = path.join(workspace, relativePath);
    try {
        return await fs.promises.readFile(fullPath, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}
const lockfile = __importStar(require("proper-lockfile"));
/**
 * 安全地、独占或异步排队写入 JSON 数据到 Workspace
 * 为了避免读写竞态条件引发文件语法损坏，这里引入 proper-lockfile 跨进程安全文件锁
 */
async function writeWorkspaceJson(workspace, relativePath, data) {
    const fullPath = path.join(workspace, relativePath);
    const tmpPath = `${fullPath}.tmp.${Date.now()}`;
    const dirPath = path.dirname(fullPath);
    // 保证目录存在
    await fs.promises.mkdir(dirPath, { recursive: true });
    let releaseLock = null;
    try {
        // 如果文件不存在，先创建一个空文件，否则 proper-lockfile 无法加锁
        if (!fs.existsSync(fullPath)) {
            await fs.promises.writeFile(fullPath, '{}', 'utf8');
        }
        // 申请分布式排他锁，如果被占用会指数退避重试 (retries: 5)
        releaseLock = await lockfile.lock(fullPath, { retries: 5 });
        // 1. 写临时文件
        await fs.promises.writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
        // 2. 原子性重命名 (防止此时读一半)
        await fs.promises.rename(tmpPath, fullPath);
    }
    catch (e) {
        console.error(`[Loader] Failed to safely write JSON to ${fullPath}`, e);
        throw e;
    }
    finally {
        if (releaseLock) {
            await releaseLock();
        }
    }
}
/**
 * 追加文本内容到 Workspace 内的文件 (如 USER.md, 日志)
 */
async function appendWorkspaceFile(workspace, relativePath, content) {
    const fullPath = path.join(workspace, relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.appendFile(fullPath, content, 'utf8');
}
