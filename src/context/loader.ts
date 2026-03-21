import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * 确定 OpenClaw Workspace 的根目录路径
 * 优先级: 传入配置 -> 环境变量 OPENCLAW_PROFILE -> 默认 ~/.openclaw/workspace/
 */
export function resolveWorkspacePath(configProfilePath?: string): string {
    // 优先级 1: 环境变量 OPENCLAW_PROFILE (标准 OpenClaw 指定)
    if (process.env.OPENCLAW_PROFILE) {
        return path.resolve(process.env.OPENCLAW_PROFILE);
    }
    // 优先级 2: 环境变量 OPENCLAW_WORKSPACE (旧版或自定义覆盖)
    if (process.env.OPENCLAW_WORKSPACE) {
        return path.resolve(process.env.OPENCLAW_WORKSPACE);
    }
    // 优先级 3: 配置传入路径 (如 ./demo_workspace)
    if (configProfilePath) {
        return path.resolve(configProfilePath);
    }
    return path.join(os.homedir(), '.openclaw', 'workspace');
}

/**
 * 安全地读取 Workspace 下的某个文件内容
 */
export async function readWorkspaceFile(workspace: string, relativePath: string): Promise<string | null> {
    const fullPath = path.join(workspace, relativePath);
    try {
        return await fs.promises.readFile(fullPath, 'utf8');
    } catch (error: any) {
        if (error.code === 'ENOENT') {
            return null;
        }
        throw error;
    }
}

import * as lockfile from 'proper-lockfile';

/**
 * 安全地、独占或异步排队写入 JSON 数据到 Workspace
 * 为了避免读写竞态条件引发文件语法损坏，这里引入 proper-lockfile 跨进程安全文件锁
 */
export async function writeWorkspaceJson(workspace: string, relativePath: string, data: any): Promise<void> {
    const fullPath = path.join(workspace, relativePath);
    const tmpPath = `${fullPath}.tmp.${Date.now()}`;
    const dirPath = path.dirname(fullPath);

    // 保证目录存在
    await fs.promises.mkdir(dirPath, { recursive: true });

    let releaseLock: (() => Promise<void>) | null = null;
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

    } catch (e: any) {
        console.error(`[Loader] Failed to safely write JSON to ${fullPath}`, e);
        throw e;
    } finally {
        if (releaseLock) {
            await releaseLock();
        }
    }
}

/**
 * 追加文本内容到 Workspace 内的文件 (如 USER.md, 日志)
 */
export async function appendWorkspaceFile(workspace: string, relativePath: string, content: string): Promise<void> {
    const fullPath = path.join(workspace, relativePath);
    await fs.promises.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.promises.appendFile(fullPath, content, 'utf8');
}
