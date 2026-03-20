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
    async executeOpenClaw(callId: string, intent: string, timeoutMs: number = 5000): Promise<ExecutionResult> {
        const openclawHome = path.join(path.dirname(this.workspaceRoot), 'openclaw_home');
        const command = `docker exec openclaw_voice_test openclaw agent --agent main --session-id "${callId}" --message "${intent.replace(/"/g, '\\"')}" --json`;
        
        const cliPromise = execAsync(command, {
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
}
