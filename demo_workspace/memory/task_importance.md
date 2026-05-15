# 任务重要性配置 (Task Importance Configuration)

> 此文件定义不同任务类型的播报优先级。用户可手动修改，也可通过对话告知系统自动更新。
> 修改后重启服务生效，或通过对话实时更新。

## 基础阈值设置

| 参数 | 默认值 | 说明 |
|------|--------|------|
| ready_threshold | 5 | READY 状态任务触发播报的最低 importance_score |
| pending_threshold | 8 | PENDING 状态任务触发播报的最低 importance_score |
| immediate_trigger_threshold | 8 | 达到此值时立即触发播报（不等待 Watchdog 扫描） |

## 任务类型优先级映射

| 任务类型 | importance_score | 说明 |
|----------|------------------|------|
| weather_mcp | 8 | |
| weather_query | 8 | |
| time_query | 8 | |
| status_check | 8 | |
| delegate_openclaw | 6 | |
| file_operation | 6 | |
| send_message | 6 | |
| archive_task | 3 | |
| summarize_task | 3 | |
| error_alert | 10 | |
| warning_alert | 9 | |

## 用户自定义优先级 (User Preferences)

> 用户通过对话告知的偏好会自动添加到这里

(暂无用户自定义偏好，可在对话中告知系统)

## 添加规则

用户可以在对话中说：
- "XX 任务很重要/不重要"
- "XX 任务要立即告诉我/不用告诉我"
- "以后 XX 任务优先级设为 N"

系统会自动解析并更新此文件。
