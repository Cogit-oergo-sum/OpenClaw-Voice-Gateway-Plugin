import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import { ToolBackend, ExecutionResult, MockBackend, OpenClawDockerBackend, distillResult } from './tool-backend';
import { ToolBackendConfig } from '../types/config';

const execAsync = promisify(exec);

/**
 * [V4.0] ExecutionResult 保持向后兼容
 */
export interface ExecutionResultCompat extends ExecutionResult {
    // 保持原有接口兼容性
}

/**
 * [V4.0] ToolExecutor: 工具执行器
 * 通过 ToolBackend 抽象支持多种执行后端
 *
 * 向后兼容：保留原有 executeOpenClaw 等方法
 */
export class DelegateExecutor {
    private backend: ToolBackend;
    private workspaceRoot: string;

    // [V4.0] 默认 backend 类型，可通过配置切换
    private backendType: 'mock' | 'openclaw-docker' = 'openclaw-docker';

    constructor(workspaceRoot: string, backendConfig?: ToolBackendConfig) {
        this.workspaceRoot = workspaceRoot;

        // 根据配置创建 backend
        if (backendConfig) {
            this.backend = this.createBackendFromConfig(backendConfig);
            this.backendType = backendConfig.type === 'mock' ? 'mock' : 'openclaw-docker';
        } else {
            // 默认使用 OpenClaw Docker Backend（向后兼容）
            // 但如果 OPENCLAW_MOCK=true，则使用 Mock Backend
            if (process.env.OPENCLAW_MOCK === 'true') {
                this.backend = new MockBackend(0);
                this.backendType = 'mock';
            } else {
                this.backend = new OpenClawDockerBackend(workspaceRoot);
                this.backendType = 'openclaw-docker';
            }
        }
    }

    private createBackendFromConfig(config: ToolBackendConfig): ToolBackend {
        switch (config.type) {
            case 'mock':
                return new MockBackend(config.mock?.latency || 0);
            case 'openclaw-docker':
                return new OpenClawDockerBackend(this.workspaceRoot, config.openclawDocker);
            case 'http':
                // HTTP Backend 需要额外实现
                throw new Error('HTTP Backend not yet implemented in DelegateExecutor');
            default:
                return new MockBackend(0);
        }
    }

    /**
     * [V4.0] 获取当前 backend 类型
     */
    getBackendType(): string {
        return this.backendType;
    }

    /**
     * [V4.0] 获取 backend 实例（供外部使用）
     */
    getBackend(): ToolBackend {
        return this.backend;
    }

    // [V3.10] Agent ID 缓存：记录已创建的 Agent（向后兼容）
    private activeAgents: Set<string> = new Set();

    /**
     * [V3.10] 创建 Agent（向后兼容）
     * 每个 taskId 对应一个独立的 Agent，确保多轮交互上下文隔离
     */
    async createAgent(agentId: string): Promise<boolean> {
        if (this.backendType === 'mock') {
            console.log(`[DelegateExecutor][MOCK] Agent ${agentId} creation simulated.`);
            this.activeAgents.add(agentId);
            return true;
        }

        // 使用 backend 的 createSession 方法
        if (this.backend.createSession) {
            const result = await this.backend.createSession(agentId);
            if (result) this.activeAgents.add(agentId);
            return result;
        }

        // 兜底：原有的 Docker 实现（修正 CLI 语法）
        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
        const dockerCmd = `docker exec openclaw_voice_test openclaw agents add "${agentId}" --non-interactive --workspace /app/workspace`;

        try {
            await execAsync(dockerCmd, {
                env: {
                    ...process.env,
                    OPENCLAW_HOME: openclawHome,
                    OPENCLAW_PROFILE: this.workspaceRoot,
                    OPENCLAW_WORKSPACE: this.workspaceRoot
                },
                timeout: 10000
            });

            // [V4.0 FIX] 等待 Agent 完全初始化：通过轮询验证 Agent 真正可用
            const maxRetries = 5;
            for (let i = 0; i < maxRetries; i++) {
                try {
                    const verifyResult = await execAsync(`docker exec openclaw_voice_test openclaw agents list --json`, { timeout: 5000 });
                    const agents = JSON.parse(verifyResult.stdout);
                    if (agents.some((a: any) => a.name === agentId || a.id === agentId)) {
                        this.activeAgents.add(agentId);
                        console.log(`[DelegateExecutor] ✅ Agent ${agentId} created and verified.`);
                        return true;
                    }
                } catch (e) {
                    // 验证失败，继续等待
                }
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            console.warn(`[DelegateExecutor] Agent ${agentId} created but verification timeout.`);
            this.activeAgents.add(agentId);
            return true;
        } catch (err: any) {
            console.error(`[DelegateExecutor] ❌ Failed to create Agent ${agentId}:`, err.message);
            return false;
        }
    }

    /**
     * [V3.10] 删除 Agent（向后兼容）
     * 任务完成后清理 Agent，释放资源
     */
    async deleteAgent(agentId: string): Promise<boolean> {
        if (this.backendType === 'mock') {
            console.log(`[DelegateExecutor][MOCK] Agent ${agentId} deletion simulated.`);
            this.activeAgents.delete(agentId);
            return true;
        }

        // 使用 backend 的 destroySession 方法
        if (this.backend.destroySession) {
            const result = await this.backend.destroySession(agentId);
            this.activeAgents.delete(agentId);
            return result;
        }

        // 兜底：原有的 Docker 实现
        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
        const dockerCmd = `docker exec openclaw_voice_test openclaw agents delete "${agentId}"`;

        try {
            await execAsync(dockerCmd, {
                env: {
                    ...process.env,
                    OPENCLAW_HOME: openclawHome,
                    OPENCLAW_PROFILE: this.workspaceRoot,
                    OPENCLAW_WORKSPACE: this.workspaceRoot
                },
                timeout: 10000
            });
            this.activeAgents.delete(agentId);
            console.log(`[DelegateExecutor] ✅ Agent ${agentId} deleted successfully.`);
            return true;
        } catch (err: any) {
            console.error(`[DelegateExecutor] ❌ Failed to delete Agent ${agentId}:`, err.message);
            this.activeAgents.delete(agentId);
            return false;
        }
    }

    /**
     * 执行 OpenClaw 代理任务 (Legacy: 使用 session-id)
     * 支持 5s 超时赛跑逻辑，用于分级反馈
     * [V4.0] 现在通过 ToolBackend 执行
     */
    async executeOpenClaw(callId: string, command: string, timeoutMs: number = 5000): Promise<ExecutionResult> {
        // 通过 backend 执行
        const result = await this.backend.execute(command, callId, timeoutMs);
        return result;
    }

    /**
     * [V3.10] 使用指定 Agent 执行 OpenClaw 任务
     * 每个 taskId 对应独立的 Agent，确保多轮交互上下文保持
     * [V4.0] 现在通过 ToolBackend 执行
     */
    async executeOpenClawWithAgent(agentId: string, command: string, timeoutMs: number = 5000): Promise<ExecutionResult> {
        // 确保 Agent 存在（如果尚未创建，自动创建）
        if (!this.activeAgents.has(agentId) && this.backendType !== 'mock') {
            await this.createAgent(agentId);
        }

        // 通过 backend 执行
        const result = await this.backend.execute(command, agentId, timeoutMs);
        return result;
    }

    /**
     * 独立等待后台任务完成并解析结果
     */
    async waitAndParse(promise: Promise<{stdout: string, stderr: string}>): Promise<ExecutionResult> {
        const { stdout, stderr } = await promise;
        let parsedData = null;
        const jsonMatch = stdout.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            try {
                parsedData = JSON.parse(jsonMatch[0]);
            } catch(e) {}
        }
        return { stdout, stderr, parsedData, isTimeout: false };
    }

    /**
     * [V3.6.5] 结果提纯：从 openClaw 的复杂返回中仅提取有效 payloads 文本
     * [V4.0] 使用统一的 distillResult 函数
     */
    static distill(result: ExecutionResult): string {
        return distillResult(result);
    }
}
