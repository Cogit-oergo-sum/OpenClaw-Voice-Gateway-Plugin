import { ToolBackendConfig } from '../types/config';

/**
 * [V4.0] 工具执行结果
 */
export interface ExecutionResult {
    stdout: string;
    stderr: string;
    parsedData?: any;
    isTimeout: boolean;
    _pendingPromise?: Promise<any>;
}

/**
 * [V4.0] ToolBackend 接口：抽象工具执行后端
 * 支持多种实现：Mock、openClaw Docker、HTTP、MCP 等
 */
export interface ToolBackend {
    /** 后端名称 */
    name: string;

    /** 后端类型 */
    type: 'mock' | 'openclaw-docker' | 'http' | 'mcp';

    /** 初始化后端 */
    init?(): Promise<void>;

    /** 执行命令/任务 */
    execute(command: string, sessionId?: string, timeoutMs?: number): Promise<ExecutionResult>;

    /** 创建会话（可选） */
    createSession?(sessionId: string): Promise<boolean>;

    /** 销毁会话（可选） */
    destroySession?(sessionId: string): Promise<boolean>;

    /** 清理资源 */
    destroy?(): Promise<void>;
}

/**
 * [V4.0] 从配置创建 ToolBackend 实例
 */
export function createBackend(config: ToolBackendConfig, workspaceRoot: string): ToolBackend {
    switch (config.type) {
        case 'mock':
            return new MockBackend(config.mock?.latency || 0);
        case 'openclaw-docker':
            return new OpenClawDockerBackend(workspaceRoot, config.openclawDocker);
        case 'http':
            return new HttpBackend(config.http!);
        default:
            // 默认使用 Mock Backend
            console.warn(`[ToolBackend] Unknown backend type: ${config.type}, falling back to MockBackend`);
            return new MockBackend(0);
    }
}

/**
 * [V4.0] Mock Backend：用于开发调试
 */
export class MockBackend implements ToolBackend {
    name = 'MockBackend';
    type = 'mock' as const;

    constructor(private latency: number = 0) {}

    async execute(command: string, sessionId?: string, timeoutMs?: number): Promise<ExecutionResult> {
        // 模拟延迟
        if (this.latency > 0) {
            await new Promise(resolve => setTimeout(resolve, this.latency));
        }

        return {
            stdout: JSON.stringify({
                status: 'success',
                message: `[MOCK] 模拟任务 "${command}" 已成功执行。`,
                result: { payloads: [{ text: `Mock result for: ${command}` }] }
            }),
            stderr: '',
            parsedData: { status: 'success', message: `[MOCK] 模拟任务 "${command}" 已成功执行。` },
            isTimeout: false
        };
    }
}

/**
 * [V4.0] openClaw Docker Backend：封装现有 DelegateExecutor 逻辑
 */
export class OpenClawDockerBackend implements ToolBackend {
    name = 'OpenClawDockerBackend';
    type = 'openclaw-docker' as const;

    private activeAgents: Set<string> = new Set();
    private container: string;
    private openclawHome: string;

    constructor(
        private workspaceRoot: string,
        config?: import('../types/config').OpenClawDockerConfig
    ) {
        this.container = config?.container || 'openclaw_voice_test';
        this.openclawHome = config?.homePath || path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
    }

    async init(): Promise<void> {
        console.log(`[OpenClawDockerBackend] Initialized with container: ${this.container}`);
    }

    async createSession(sessionId: string): Promise<boolean> {
        if (this.activeAgents.has(sessionId)) {
            console.log(`[OpenClawDockerBackend] Agent ${sessionId} already exists.`);
            return true;
        }

        try {
            await execAsync(`docker exec ${this.container} openclaw agents add "${sessionId}" --non-interactive --workspace /app/workspace`, {
                env: {
                    ...process.env,
                    OPENCLAW_HOME: this.openclawHome,
                    OPENCLAW_PROFILE: this.workspaceRoot,
                    OPENCLAW_WORKSPACE: this.workspaceRoot
                },
                timeout: 10000
            });

            // [V4.0 FIX] 等待 Agent 完全初始化：通过轮询验证 Agent 真正可用
            // 解决竞态条件：创建命令返回成功，但 OpenClaw 内部 Agent 还未完全初始化
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    const verifyResult = await execAsync(`docker exec ${this.container} openclaw agents list --json`, { timeout: 5000 });
                    const agents = JSON.parse(verifyResult.stdout);
                    if (agents.some((a: any) => a.name === sessionId || a.id === sessionId)) {
                        this.activeAgents.add(sessionId);
                        console.log(`[OpenClawDockerBackend] Agent ${sessionId} created and verified.`);
                        return true;
                    }
                } catch (e) {
                    // 验证失败，继续等待
                }
                await new Promise(resolve => setTimeout(resolve, 500)); // 等待 500ms
            }

            console.warn(`[OpenClawDockerBackend] Agent ${sessionId} created but verification timeout.`);
            this.activeAgents.add(sessionId); // 仍然添加到缓存，允许后续尝试
            return true;
        } catch (err: any) {
            console.error(`[OpenClawDockerBackend] Failed to create agent ${sessionId}:`, err.message);
            return false;
        }
    }

    async destroySession(sessionId: string): Promise<boolean> {
        try {
            await execAsync(`docker exec ${this.container} openclaw agents delete "${sessionId}"`, {
                env: {
                    ...process.env,
                    OPENCLAW_HOME: this.openclawHome,
                    OPENCLAW_PROFILE: this.workspaceRoot,
                    OPENCLAW_WORKSPACE: this.workspaceRoot
                },
                timeout: 10000
            });
            this.activeAgents.delete(sessionId);
            console.log(`[OpenClawDockerBackend] Agent ${sessionId} deleted.`);
            return true;
        } catch (err: any) {
            console.error(`[OpenClawDockerBackend] Failed to delete agent ${sessionId}:`, err.message);
            this.activeAgents.delete(sessionId);
            return false;
        }
    }

    async execute(command: string, sessionId?: string, timeoutMs: number = 5000): Promise<ExecutionResult> {
        const dockerCmd = sessionId
            ? `docker exec ${this.container} openclaw agent --agent "${sessionId}" --message "${command.replace(/"/g, '\\"')}" --json`
            : `docker exec ${this.container} openclaw agent --agent main --session-id "${sessionId || 'default'}" --message "${command.replace(/"/g, '\\"')}" --json`;

        const cliPromise = execAsync(dockerCmd, {
            env: {
                ...process.env,
                OPENCLAW_HOME: this.openclawHome,
                OPENCLAW_PROFILE: this.workspaceRoot,
                OPENCLAW_WORKSPACE: this.workspaceRoot
            },
            timeout: 300000
        });

        const timeoutPromise = new Promise<ExecutionResult>((_, reject) =>
            setTimeout(() => reject(new Error('TIMEOUT_RACE')), timeoutMs)
        );

        try {
            const raceResult = await Promise.race([cliPromise, timeoutPromise]) as { stdout: string; stderr: string };

            let parsedData = null;
            const jsonMatch = raceResult.stdout.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
                try {
                    parsedData = JSON.parse(jsonMatch[0]);
                } catch(e) {}
            }

            return {
                stdout: raceResult.stdout,
                stderr: raceResult.stderr,
                parsedData,
                isTimeout: false
            };
        } catch (err: any) {
            if (err.message === 'TIMEOUT_RACE') {
                return {
                    stdout: '',
                    stderr: '',
                    isTimeout: true,
                    _pendingPromise: cliPromise as any
                };
            }
            throw err;
        }
    }

    async destroy(): Promise<void> {
        // 清理所有活跃的 agent
        for (const agentId of this.activeAgents) {
            await this.destroySession(agentId).catch(() => {});
        }
    }
}

/**
 * [V4.0] HTTP Backend：调用外部 HTTP endpoint
 */
export class HttpBackend implements ToolBackend {
    name = 'HttpBackend';
    type = 'http' as const;

    constructor(private config: NonNullable<ToolBackendConfig['http']>) {}

    async execute(command: string, sessionId?: string, timeoutMs?: number): Promise<ExecutionResult> {
        const timeout = timeoutMs || this.config.timeout || 30000;
        const method = this.config.method || 'POST';

        const body = method === 'POST' ? JSON.stringify({ command, sessionId }) : undefined;
        const url = sessionId
            ? `${this.config.endpoint}?sessionId=${sessionId}`
            : this.config.endpoint;

        try {
            const response = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    ...this.config.headers
                },
                body,
                signal: AbortSignal.timeout(timeout)
            });

            const text = await response.text();
            let parsedData = null;
            try {
                parsedData = JSON.parse(text);
            } catch(e) {}

            return {
                stdout: text,
                stderr: response.ok ? '' : `HTTP ${response.status}: ${response.statusText}`,
                parsedData,
                isTimeout: false
            };
        } catch (err: any) {
            if (err.name === 'AbortError' || err.name === 'TimeoutError') {
                return {
                    stdout: '',
                    stderr: '',
                    isTimeout: true
                };
            }
            throw err;
        }
    }
}

// 导入必要模块
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

/**
 * [V4.0] 结果提纯：从各种 backend 的返回中提取有效文本
 */
export function distillResult(result: ExecutionResult): string {
    // openClaw 格式
    const payloads = result.parsedData?.result?.payloads;
    if (Array.isArray(payloads) && payloads.length > 0) {
        return payloads
            .map((p: any) => p.text || p.content || (typeof p === 'string' ? p : ''))
            .filter(t => t.trim() !== '')
            .join('\n\n');
    }

    // HTTP JSON 格式
    if (result.parsedData?.message) return result.parsedData.message;
    if (result.parsedData?.text) return result.parsedData.text;
    if (result.parsedData?.result) return result.parsedData.result;

    // Mock 格式
    if (result.parsedData?.status === 'success' && result.parsedData?.message) {
        return result.parsedData.message;
    }

    // 兜底
    return (result.stdout || '').trim() || '任务已执行，无结果返回。';
}