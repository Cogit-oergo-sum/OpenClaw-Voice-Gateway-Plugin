---
name: delegate_task
description: "将任务（如：查询文件、写文件、搜资料、分析代码等所有需要操作电脑的任务）委派给后台专家处理。此工具耗时较长（>2秒）。"
parameters:
  type: object
  properties:
    command:
      type: string
      description: "【核心执行参数】重写后的完整任务指令。你必须结合历史上下文，进行实体补全和指代消解。严禁直接传入用户的原始口语化输入。"
    backend:
      type: string
      description: "可选：指定使用的后端类型 (openclaw, http, mock)。默认使用系统配置的后端。"
  required:
    - command
isLongRunning: true
runtime: native
enabled: false
---
# 技能说明
通用任务委派技能，将用户指令委派给后台 Agent（openClaw/Claude Code 等）执行。
