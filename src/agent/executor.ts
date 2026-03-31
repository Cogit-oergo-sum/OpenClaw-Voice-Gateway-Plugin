import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';

const execAsync = promisify(exec);

export interface ExecutionResult {
    stdout: string;
    stderr: string;
    parsedData?: any;
    isTimeout: boolean;
    _pendingPromise?: Promise<any>;
}

/**
 * [V3.2.0] DelegateExecutor: 工具委派执行器
 * 负责子进程调用、超时竞速及结果解析
 */
export class DelegateExecutor {
    constructor(private workspaceRoot: string) {}

    /**
     * 执行 OpenClaw 代理任务
     * 支持 5s 超时赛跑逻辑，用于分级反馈
     */
    async executeOpenClaw(callId: string, command: string, timeoutMs: number = 5000): Promise<ExecutionResult> {
        // [V3.6.24] 极速 Mock 模式拦截，用于 dev 指令下的纯逻辑/UI 调试
        if (process.env.OPENCLAW_MOCK === 'true') {
            console.log(`[DelegateExecutor][MOCK] Intercepted command: "${command}"`);
            return {
                stdout: JSON.stringify({ status: 'success', message: `[MOCK] 模拟任务 "${command}" 已成功执行。` }),
                stderr: '',
                parsedData: { status: 'success' },
                isTimeout: false
            };
        }

        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
        const dockerCmd = `docker exec openclaw_voice_test openclaw agent --agent main --session-id "${callId}" --message "${(command || '').replace(/"/g, '\\"')}" --json`;
        
        const cliPromise = execAsync(dockerCmd, {
            env: { 
                ...process.env, 
                OPENCLAW_HOME: openclawHome,
                OPENCLAW_PROFILE: this.workspaceRoot,
                OPENCLAW_WORKSPACE: this.workspaceRoot
            },
            timeout: 60000 
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
                // 如果触发超时赛跑，返回 timeout 状态，但底层 cliPromise 仍然在后台运行
                // 注意：这里我们无法直接获得 cliPromise 的句柄来供外部继续 await，
                // 但调用者可以通过 background 处理
                return {
                    stdout: '',
                    stderr: '',
                    isTimeout: true,
                    // 将原始 promise 传回给调用者以便后续处理
                    _pendingPromise: cliPromise as any 
                };
            }
            throw err;
        }
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
     */
    static distill(result: ExecutionResult): string {
        const payloads = result.parsedData?.result?.payloads;
        if (Array.isArray(payloads) && payloads.length > 0) {
            // 仅提取 payloads 中的关键文本，过滤 JSON 和 STDOUT 噪音
            return payloads
                .map((p: any) => p.text || p.content || (typeof p === 'string' ? p : ''))
                .filter(t => t.trim() !== '')
                .join('\n\n');
        }
        // 兜底：尝试查找 common JSON 结果中的 message/text 字段
        if (result.parsedData?.message) return result.parsedData.message;
        if (result.parsedData?.text) return result.parsedData.text;

        return (result.stdout || '').trim() || '任务已执行，无结果返回。';
    }
}
