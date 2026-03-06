/**
 * 确定 OpenClaw Workspace 的根目录路径
 * 优先级: 传入配置 -> 环境变量 OPENCLAW_PROFILE -> 默认 ~/.openclaw/workspace/
 */
export declare function resolveWorkspacePath(configProfilePath?: string): string;
/**
 * 安全地读取 Workspace 下的某个文件内容
 */
export declare function readWorkspaceFile(workspace: string, relativePath: string): Promise<string | null>;
/**
 * 安全地、独占或异步排队写入 JSON 数据到 Workspace
 * 为了避免读写竞态条件引发文件语法损坏，这里引入 proper-lockfile 跨进程安全文件锁
 */
export declare function writeWorkspaceJson(workspace: string, relativePath: string, data: any): Promise<void>;
/**
 * 追加文本内容到 Workspace 内的文件 (如 USER.md, 日志)
 */
export declare function appendWorkspaceFile(workspace: string, relativePath: string, content: string): Promise<void>;
