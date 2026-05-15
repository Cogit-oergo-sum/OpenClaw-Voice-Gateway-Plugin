/**
 * Fast Agent 验证框架 - 统一类型定义
 *
 * 用于各组件（router/slc/sle/canvas/memory/watchdog）的验证报告标准化
 */

/**
 * 验证组件类型
 */
export type ValidationComponent = 'router' | 'slc' | 'sle' | 'canvas' | 'memory' | 'watchdog' | 'integrated';

/**
 * 验证报告统一格式
 */
export interface ValidationReport {
    component: ValidationComponent;
    timestamp: string;
    version: string;              // 组件版本号
    model?: string;               // 使用的模型（如 qwen-turbo）
    testSuite: string;            // 测试套件名称
    totalCases: number;           // 总测试用例数

    metrics: ValidationMetrics;
    categoryBreakdown: Record<string, CategoryStats>;
    failures: FailureDetail[];
    passed: boolean;

    environment: {
        nodeVersion: string;
        platform: string;
        configOverrides?: Record<string, any>;
    };
}

/**
 * 验证指标（各组件通用）
 */
export interface ValidationMetrics {
    // 准确率指标
    strictAccuracy?: number;      // 严格匹配率 (%)
    tolerantAccuracy?: number;    // 容错通过率 (%)
    criticalFailures?: number;    // 关键失败数

    // 延迟指标
    avgLatency?: number;          // 平均延迟 (ms)
    p95Latency?: number;          // P95延迟 (ms)
    ttft?: number;                // 首字延迟 (ms)
    minLatency?: number;          // 最小延迟 (ms)
    maxLatency?: number;          // 最大延迟 (ms)

    // 组件特定指标
    toolExecutionRate?: number;   // 工具执行成功率 (%) - SLE
    emotionMatchRate?: number;    // 情绪匹配率 (%) - SLC
    memoryHitRate?: number;       // 记忆检索命中率 (%) - Memory
    consistencyRate?: number;     // 状态一致性 (%) - Canvas
    cleanupRate?: number;         // 任务清理率 (%) - Watchdog
}

/**
 * 分类统计
 */
export interface CategoryStats {
    total: number;
    passed: number;
    failed: number;
    critical: number;             // 关键失败数
    acceptable: number;           // 可接受失败数
    accuracy: number;             // 准确率 (%)
}

/**
 * 失败详情
 */
export interface FailureDetail {
    testCaseId: string;
    input: string;
    expected: any;
    actual: any;
    reason: string;
    isCritical: boolean;          // 是否关键失败
    isAcceptable: boolean;        // 是否可接受误判
    category: string;
    latency?: number;             // 该用例延迟
}

/**
 * 验证配置
 */
export interface ValidationConfig {
    component: ValidationComponent;
    model?: string;
    iterations?: number;          // 重复测试次数
    outputFormat: 'console' | 'json' | 'markdown';
    outputPath?: string;
    strict?: boolean;             // 严格模式（关键失败必须为0）
    verbose?: boolean;            // 详细输出
}

/**
 * 验证标准定义
 */
export interface ValidationStandard {
    component: ValidationComponent;
    metrics: {
        [key: string]: {
            threshold: number;     // 阈值
            required: boolean;     // 是否强制达标
            operator: 'gte' | 'lte' | 'eq';  // 比较操作符
            description: string;
        };
    };
}

/**
 * 测试用例基础接口
 */
export interface TestCase {
    id: string;
    input: string;
    category: string;
    description?: string;
}

/**
 * IntentRouter 测试用例
 */
export interface RouterTestCase extends TestCase {
    canvas: any[] | null;         // 画布状态
    history: string[];            // 对话历史
    expected: {
        intents?: Array<{ type: string }>;
        isAnswerInActiveCanvas?: boolean;
    };
}

/**
 * SLE 期望输出定义（用于联合验证）
 */
export interface SLEExpectation {
    shouldCallTool: boolean;           // 是否应调用工具
    expectedIntent?: string;           // 期望的工具 slug（如 'weather_mcp'）
    directResponseExpected?: boolean;  // 是否期望直接回答（兜底场景）
}

/**
 * 联合验证测试用例（扩展 RouterTestCase，增加 SLE 阶段期望）
 */
export interface IntegratedTestCase extends RouterTestCase {
    // SLE 阶段期望（可选，仅当 Router 判定为 NEW_TASK 时触发）
    sleExpectation?: SLEExpectation;

    // 最终期望结果
    finalExpectation: {
        outcome: 'TASK_CREATED' | 'DIRECT_RESPONSE' | 'CANVAS_ANSWER' | 'CANCELLED' | 'CLARIFY' | 'NO_ACTION';
        noAction?: boolean;              // 最终无操作（纯闲聊）
    };
}

/**
 * 测试结果
 */
export interface TestResult {
    testCaseId: string;
    passed: boolean;
    isCritical: boolean;
    isAcceptable: boolean;
    latency?: number;
    expected: any;
    actual: any;
    reason?: string;
}

/**
 * SLE 输出结果（模拟 SLE.run 返回值）
 */
export interface SLEOutputResult {
    output: string;           // SLE 输出的回复内容
    toolCalls: any[];         // 工具调用数组
    intent: string;           // 工具 slug
    parsed?: any;             // 解析后的 JSON
}

/**
 * 联合验证测试结果（IntentRouter + SLE）
 */
export interface IntegratedTestResult extends TestResult {
    // Router 层结果
    routerPassed: boolean;
    routerAcceptable: boolean;
    routerCritical: boolean;
    routerReason?: string;

    // SLE 层结果
    sleTriggered: boolean;
    slePassed: boolean;
    sleFallback: boolean;       // SLE 是否成功兜底
    sleReason?: string;

    // 最终结果
    finalPassed: boolean;
    finalOutcome: string;
    finalReason?: string;
}

/**
 * 联合验证指标（IntentRouter + SLE）
 */
export interface IntegratedValidationMetrics extends ValidationMetrics {
    // Router 层指标
    routerStrictAccuracy: number;      // Router 严格匹配率
    routerTolerantAccuracy: number;    // Router 容错通过率
    routerCriticalFailures: number;    // Router 关键漏判数

    // SLE 层指标
    sleTriggerRate: number;            // SLE 触发率
    sleFallbackRate: number;           // SLE 兜底成功率
    sleToolCallAccuracy: number;       // SLE 工具调用准确率

    // 联合指标
    finalAccuracy: number;             // 整体判断准确率（两层联合后）
    fallbackSuccessRate: number;       // 兜底成功率 = SLE兜底成功数 / Router误判数
}

/**
 * 验证套件接口
 */
export interface ValidationSuite {
    name: string;
    component: ValidationComponent;
    testCases: TestCase[];
    standard: ValidationStandard;
    run: (testCase: TestCase, config: ValidationConfig) => Promise<TestResult>;
}

/**
 * 各组件验证标准常量
 */
export const VALIDATION_STANDARDS: Record<ValidationComponent, ValidationStandard> = {
    router: {
        component: 'router',
        metrics: {
            tolerantAccuracy: {
                threshold: 90,
                required: true,
                operator: 'gte',
                description: '容错通过率'
            },
            criticalFailures: {
                threshold: 0,
                required: true,
                operator: 'eq',
                description: '关键漏判数'
            },
            avgLatency: {
                threshold: 200,
                required: true,
                operator: 'lte',
                description: '平均延迟'
            },
            multiRoundAccuracy: {
                threshold: 90,
                required: false,
                operator: 'gte',
                description: '多轮指代准确率'
            }
        }
    },
    slc: {
        component: 'slc',
        metrics: {
            ttft: {
                threshold: 600,
                required: true,
                operator: 'lte',
                description: '首字延迟'
            },
            emotionMatchRate: {
                threshold: 80,
                required: false,
                operator: 'gte',
                description: '情绪匹配率'
            }
        }
    },
    sle: {
        component: 'sle',
        metrics: {
            toolExecutionRate: {
                threshold: 95,
                required: true,
                operator: 'gte',
                description: '工具执行成功率'
            },
            reasoningAccuracy: {
                threshold: 90,
                required: true,
                operator: 'gte',
                description: '推理准确率'
            }
        }
    },
    canvas: {
        component: 'canvas',
        metrics: {
            consistencyRate: {
                threshold: 100,
                required: true,
                operator: 'eq',
                description: '状态一致性'
            }
        }
    },
    memory: {
        component: 'memory',
        metrics: {
            memoryHitRate: {
                threshold: 80,
                required: false,
                operator: 'gte',
                description: '检索命中率'
            }
        }
    },
    watchdog: {
        component: 'watchdog',
        metrics: {
            cleanupRate: {
                threshold: 100,
                required: true,
                operator: 'eq',
                description: '任务清理率'
            }
        }
    },
    integrated: {
        component: 'integrated',
        metrics: {
            routerTolerantAccuracy: {
                threshold: 90,
                required: true,
                operator: 'gte',
                description: 'Router 容错通过率'
            },
            routerCriticalFailures: {
                threshold: 0,
                required: true,
                operator: 'eq',
                description: 'Router 关键漏判数'
            },
            finalAccuracy: {
                threshold: 95,
                required: true,
                operator: 'gte',
                description: '整体判断准确率'
            },
            sleFallbackRate: {
                threshold: 80,
                required: false,
                operator: 'gte',
                description: 'SLE 兜底成功率'
            }
        }
    }
};