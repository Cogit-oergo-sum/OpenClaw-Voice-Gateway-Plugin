# Fast Agent 验证框架使用指南

## 概述

本验证框架用于持续验证 Fast Agent 各组件的准确性和性能，支持以下组件：

| 组件 | 验证内容 | 关键指标 |
|------|----------|----------|
| **IntentRouter** | 意图识别准确率 | 漏判率=0、延迟≤200ms |
| **SLC** | 极速响应效果 | TTFT≤600ms、情绪匹配率 |
| **SLE** | 工具执行推理 | 执行成功率≥95% |
| **Canvas** | 状态一致性 | 一致性=100% |
| **Memory** | 记忆检索 | 命中率≥80% |
| **Watchdog** | 任务清理 | 清理率=100% |

---

## 快速开始

### 1. 单组件验证

```bash
# IntentRouter 准确率验证
npm run test:router

# 指定模型验证
npm run test:router qwen3-14b

# 严格模式（关键失败必须为0）
npm run test:router -- --strict --verbose
```

### 2. 延迟验证

```bash
# IntentRouter 延迟验证（3次迭代）
npm run test:router:latency -- --iter=3
```

### 3. P0 回归验证

```bash
# 关键组件回归
npm run test:p0

# 或使用新框架
ts-node --transpile-only scripts/validation/index.ts --p0
```

### 4. 全量验证

```bash
# 所有组件验证
npm run test:all

# 生成报告
npm run test:all -- --save
```

---

## 验证标准

### IntentRouter 容错标准

```
【可接受误判】（不会导致功能失效）
- 闲聊 → 任务（NEW_TASK/CANCEL_TASK/CLARIFY）→ SLE 会兜底
- 画布引用 → NEW_TASK → SLE 会兜底

【不可接受漏判】（关键失败）
- NEW_TASK → 闲聊（空意图）→ 任务无法创建
- NEW_TASK → 画布引用 → 任务无法创建
- CANCEL_TASK → 闲聊 → 任务无法取消

验证标准：
- 容错通过率 ≥ 90%
- 关键漏判数 = 0（强制）
- 平均延迟 ≤ 200ms
```

### SLC 响应标准

```
- TTFT ≤ 600ms（强制）
- 情绪匹配率 ≥ 80%（非强制）
- 垫词使用率 ≤ 10%
```

### SLE 工具执行标准

```
- 工具执行成功率 ≥ 95%（强制）
- 推理准确率 ≥ 90%（强制）
- 错误处理覆盖率 = 100%
```

---

## 命令行参数

| 参数 | 说明 | 示例 |
|------|------|------|
| `--model=<name>` | 指定模型 | `--model=qwen3-14b` |
| `--iter=<n>` | 重复测试次数 | `--iter=3` |
| `--strict` | 严格模式 | `--strict` |
| `--verbose` | 详细输出 | `--verbose` |
| `--json` | JSON 输出 | `--json` |
| `--save` | 保存报告 | `--save` |
| `--all` | 全量验证 | `--all` |
| `--p0` | P0 回归 | `--p0` |
| `--report` | 生成报告 | `--report` |

---

## 目录结构

```
scripts/validation/
├── types.ts               # 统一类型定义
├── runner.ts              # 测试执行器
├── report-generator.ts    # 报告生成器
├── index.ts               # CLI 入口
│
├── router/                # IntentRouter 验证套件
│   ├── test-cases.ts      # 79条测试用例
│   ├── accuracy.ts        # 准确率验证
│   └── latency.ts         # 延迟验证（待建）
│
├── slc/                   # SLC 验证套件（待建）
├── sle/                   # SLE 验证套件（待建）
├── canvas/                # Canvas 验证套件（待建）
├── memory/                # Memory 验证套件（待建）
└── watchdog/              # Watchdog 验证套件（待建）

doc/validation/
├── README.md              # 使用指南（本文件）
├── standards/             # 验证标准文档
│   ├── router-standard.md
│   ├── slc-standard.md
│   └── sle-standard.md
│
└── reports/               # 验证报告存储
    ├── router/
    ├── slc/
    ├── sle/
    └── integrated/
```

---

## 添加新验证套件

### 1. 创建测试用例文件

```typescript
// scripts/validation/<component>/test-cases.ts

export const TEST_CASES = [
    { id: 'CASE-01', input: '测试输入', expected: {...}, ... },
    // ...
];
```

### 2. 创建验证脚本

```typescript
// scripts/validation/<component>/accuracy.ts

import { ValidationSuite, getValidationSuite } from '../types';

export function getValidationSuite(): ValidationSuite {
    return {
        name: '<Component> Validation',
        component: '<component>',
        testCases: TEST_CASES,
        standard: VALIDATION_STANDARDS.<component>,
        run: async (testCase, config) => {
            // 执行验证逻辑
            return { testCaseId, passed, isCritical, ... };
        }
    };
}
```

### 3. 添加 npm script

```json
// package.json
"test:<component>": "ts-node --transpile-only scripts/validation/<component>/accuracy.ts"
```

---

## 验证报告格式

验证报告以 Markdown 格式保存，包含：

1. **Metrics Summary** - 关键指标达标情况
2. **Category Breakdown** - 分类统计
3. **Failures** - 失败详情（区分关键失败和可接受误判）
4. **Environment** - 环境信息

报告存储路径：`doc/validation/reports/<component>/<timestamp>.md`

---

## 持续验证流程

### 开发时

```bash
# 提交前快速验证
npm run test:router -- --strict
```

### CI/CD

```bash
# 自动化验证
npm run test:p0
```

### 定期回归

```bash
# 全量验证并生成报告
npm run test:all -- --save
```

---

## 常见问题

### Q: 验证失败如何处理？

1. 检查关键失败详情
2. 分析失败原因（漏判/误判）
3. 优化 Prompt 或模型参数
4. 重新验证

### Q: 如何选择最优模型？

```bash
# 对比不同模型
npm run test:router qwen-turbo
npm run test:router qwen3-14b
npm run test:router qwen3-8b
```

### Q: 测试用例如何更新？

编辑 `scripts/validation/<component>/test-cases.ts`，添加新用例或修改期望值。

---

## 参考资料

- [IntentRouter 验证标准](./standards/router-standard.md)
- [SLC 验证标准](./standards/slc-standard.md)
- [SLE 验证标准](./standards/sle-standard.md)