import * as fs from 'fs';
import * as path from 'path';

/**
 * [V3.11] TaskImportanceConfig: 任务重要性配置
 * 用户可通过 markdown 文件自定义任务优先级，也可通过对话告知系统自动更新
 */
export interface TaskImportanceConfig {
    ready_threshold: number;
    pending_threshold: number;
    immediate_trigger_threshold: number;
    task_type_scores: Record<string, number>;
    user_preferences: Record<string, number>;
}

/**
 * [V3.11] TaskImportanceManager: 任务重要性配置管理器
 * 负责:
 * 1. 从 markdown 文件加载配置
 * 2. 提供重要性评分查询接口
 * 3. 支持用户偏好动态更新
 */
export class TaskImportanceManager {
    private configPath: string;
    private config: TaskImportanceConfig;

    constructor(workspaceRoot: string) {
        this.configPath = path.join(workspaceRoot, 'memory', 'task_importance.md');
        this.config = this.loadConfig();
    }

    /**
     * 加载配置，如果文件不存在则创建默认配置
     */
    private loadConfig(): TaskImportanceConfig {
        const defaultConfig: TaskImportanceConfig = {
            ready_threshold: 5,
            pending_threshold: 8,
            immediate_trigger_threshold: 8,
            task_type_scores: {
                'weather_mcp': 8,
                'weather_query': 8,
                'time_query': 8,
                'status_check': 8,
                'delegate_openclaw': 6,
                'file_operation': 6,
                'send_message': 6,
                'archive_task': 3,
                'summarize_task': 3,
                'error_alert': 10,
                'warning_alert': 9,
            },
            user_preferences: {}
        };

        // 确保目录存在
        const dir = path.dirname(this.configPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        if (!fs.existsSync(this.configPath)) {
            this.saveConfig(defaultConfig);
            console.log('[TaskImportanceManager] 📝 Created default config file');
            return defaultConfig;
        }

        try {
            const content = fs.readFileSync(this.configPath, 'utf8');
            const parsed = this.parseMarkdown(content, defaultConfig);
            console.log('[TaskImportanceManager] ✅ Loaded config from file');
            return parsed;
        } catch (e) {
            console.error('[TaskImportanceManager] ❌ Failed to parse config, using defaults:', e);
            return defaultConfig;
        }
    }

    /**
     * 解析 markdown 格式的配置文件
     */
    private parseMarkdown(content: string, defaultConfig: TaskImportanceConfig): TaskImportanceConfig {
        const config = { ...defaultConfig, task_type_scores: { ...defaultConfig.task_type_scores }, user_preferences: {} };

        // 解析基础阈值表格
        const thresholdMatch = content.match(/## 基础阈值设置\s*\n\n?\|[^|]+\|[^|]+\|[^|]+\|\s*\n\|[^|]+\|[^|]+\|[^|]+\|[\s\S]*?(?=##|$)/);
        if (thresholdMatch) {
            const lines = thresholdMatch[0].split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
            for (const line of lines.slice(1)) { // 跳过标题行
                const cols = line.split('|').filter(c => c.trim());
                if (cols.length >= 3) {
                    const key = cols[0].trim();
                    const val = parseInt(cols[1].trim());
                    if (key === 'ready_threshold' && !isNaN(val)) config.ready_threshold = val;
                    if (key === 'pending_threshold' && !isNaN(val)) config.pending_threshold = val;
                    if (key === 'immediate_trigger_threshold' && !isNaN(val)) config.immediate_trigger_threshold = val;
                }
            }
        }

        // 解析任务类型优先级表格
        const taskTypeMatch = content.match(/## 任务类型优先级映射\s*\n\n?\|[^|]+\|[^|]+\|[^|]+\|\s*\n\|[^|]+\|[^|]+\|[^|]+\|[\s\S]*?(?=##|$)/);
        if (taskTypeMatch) {
            const lines = taskTypeMatch[0].split('\n').filter(l => l.startsWith('|') && !l.includes('---'));
            for (const line of lines.slice(1)) {
                const cols = line.split('|').filter(c => c.trim());
                if (cols.length >= 2) {
                    const taskType = cols[0].trim();
                    const score = parseInt(cols[1].trim());
                    if (!isNaN(score)) {
                        config.task_type_scores[taskType] = score;
                    }
                }
            }
        }

        // 解析用户自定义优先级 (简单格式: - "规则" → task_type: score)
        const userPrefMatch = content.match(/## 用户自定义优先级[\s\S]*?(?=##|$)/);
        if (userPrefMatch) {
            const prefLines = userPrefMatch[0].split('\n');
            for (const line of prefLines) {
                const m = line.match(/→\s*([a-zA-Z_]+):\s*(\d+)/);
                if (m) {
                    const taskType = m[1].trim();
                    const score = parseInt(m[2]);
                    if (!isNaN(score)) {
                        config.user_preferences[taskType] = score;
                    }
                }
            }
        }

        return config;
    }

    /**
     * 保存配置到 markdown 文件
     */
    private saveConfig(config: TaskImportanceConfig): void {
        const markdown = this.generateMarkdown(config);
        fs.writeFileSync(this.configPath, markdown, 'utf8');
    }

    /**
     * 生成 markdown 格式的配置文件
     */
    private generateMarkdown(config: TaskImportanceConfig): string {
        const taskTypeRows = Object.entries(config.task_type_scores)
            .map(([type, score]) => `| ${type} | ${score} | |`)
            .join('\n');

        const userPrefRows = Object.entries(config.user_preferences).length > 0
            ? Object.entries(config.user_preferences)
                .map(([type, score]) => `- "用户设置" → ${type}: ${score}`)
                .join('\n')
            : '(暂无用户自定义偏好，可在对话中告知系统)';

        return `# 任务重要性配置 (Task Importance Configuration)

> 此文件定义不同任务类型的播报优先级。用户可手动修改，也可通过对话告知系统自动更新。
> 修改后重启服务生效，或通过对话实时更新。

## 基础阈值设置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| ready_threshold | ${config.ready_threshold} | READY 状态任务触发播报的最低 importance_score |
| pending_threshold | ${config.pending_threshold} | PENDING 状态任务触发播报的最低 importance_score |
| immediate_trigger_threshold | ${config.immediate_trigger_threshold} | 达到此值时立即触发播报（不等待 Watchdog 扫描） |

## 任务类型优先级映射

| 任务类型 | importance_score | 说明 |
|----------|------------------|------|
${taskTypeRows}

## 用户自定义优先级 (User Preferences)

> 用户通过对话告知的偏好会自动添加到这里

${userPrefRows}

## 添加规则

用户可以在对话中说：
- "XX 任务很重要/不重要"
- "XX 任务要立即告诉我/不用告诉我"
- "以后 XX 任务优先级设为 N"

系统会自动解析并更新此文件。
`;
    }

    /**
     * 获取指定任务类型的重要性评分
     * 用户偏好优先于系统默认配置
     */
    getImportanceScore(taskType: string): number {
        // 用户偏好优先
        if (this.config.user_preferences[taskType] !== undefined) {
            return this.config.user_preferences[taskType];
        }
        // 其次任务类型映射
        return this.config.task_type_scores[taskType] || 5;
    }

    /**
     * 获取指定状态的播报阈值
     */
    getThreshold(status: 'READY' | 'PENDING'): number {
        return status === 'READY' ? this.config.ready_threshold : this.config.pending_threshold;
    }

    /**
     * 获取即时触发阈值
     */
    getImmediateTriggerThreshold(): number {
        return this.config.immediate_trigger_threshold;
    }

    /**
     * 判断是否应该立即触发播报
     */
    shouldImmediateTrigger(score: number): boolean {
        return score >= this.config.immediate_trigger_threshold;
    }

    /**
     * 更新用户偏好并持久化
     * 用户对话告知时调用
     */
    updateUserPreference(taskType: string, score: number): void {
        // 确保分数在有效范围内
        score = Math.max(1, Math.min(10, score));
        this.config.user_preferences[taskType] = score;
        this.saveConfig(this.config);
        console.log(`[TaskImportanceManager] 📝 User preference updated: ${taskType} → ${score}`);
    }

    /**
     * 移除用户偏好
     */
    removeUserPreference(taskType: string): void {
        delete this.config.user_preferences[taskType];
        this.saveConfig(this.config);
        console.log(`[TaskImportanceManager] 🗑️ User preference removed: ${taskType}`);
    }

    /**
     * 获取当前配置（供调试使用）
     */
    getConfig(): TaskImportanceConfig {
        return { ...this.config };
    }

    /**
     * 重新加载配置（供外部调用）
     */
    reload(): void {
        this.config = this.loadConfig();
        console.log('[TaskImportanceManager] 🔄 Config reloaded');
    }
}