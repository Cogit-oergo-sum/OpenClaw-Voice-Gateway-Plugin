---
name: weather_mcp
description: "获取指定城市的实时天气预报和指数。"
parameters:
  type: object
  properties:
    city:
      type: string
      description: "城市名称，如：北京"
  required:
    - city
isLongRunning: true
runtime: native
endpoint: "http://localhost:3003/weather"
method: "POST"
---
# 技能说明
这是一个获取天气的 MCP 示例技能。
当你获取到天气后，请提取出温度和天气状况，并简要汇报。
若有海量细节，请仅告知当前体感。
