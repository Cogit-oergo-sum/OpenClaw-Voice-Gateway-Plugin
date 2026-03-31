---
name: search_zego_docs
description: "检索 ZEGO (即构科技) 官方开发者文档。当你被问到和 ZEGO 相关的技术问题或如何集成 ZEGO 的产品时必须调用本接口。"
parameters:
  type: object
  properties:
    query:
      type: string
      description: "搜索关键词或具体问题（如：如何开通并在服务器端集成实时互动 AI Agent）"
  required:
    - query
isLongRunning: true
endpoint: "http://localhost:3004/search"
method: "POST"
---
# 技能说明
这是一个针对 ZEGO MCP 服务进行代理包装的技能配置。
当你通过该技能获取到具体文档知识后：
1. 请简要凝练出核心操作步骤，告诉用户。
2. 切勿朗读长篇代码或所有文本，保留在画布 (Canvas) 供用户通过页面阅读详情即可。
