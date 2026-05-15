/**
 * Fast Agent 验证框架 - 测试执行器
 *
 * 负责加载测试套件、执行测试、生成报告
 */

import { ValidationConfig, ValidationReport, ValidationSuite, TestResult, TestCase, VALIDATION_STANDARDS, ValidationComponent } from './types';
import { ReportGenerator } from './report-generator';
import * as os from 'os';

export class ValidationRunner {
    private reportGenerator = new ReportGenerator();

    /**
     * 执行单个组件验证
     */
    async runComponentValidation(config: ValidationConfig): Promise<ValidationReport> {
        const suite = await this.loadTestSuite(config.component);
        const results: TestResult[] = [];

        console.log(`\n🚀 Running ${config.component} validation...`);
        console.log(`   Model: ${config.model || 'default'}`);
        console.log(`   Test cases: ${suite.testCases.length}`);
        console.log('');

        // 执行测试
        for (const testCase of suite.testCases) {
            const result = await this.executeTest(testCase, suite, config);
            results.push(result);

            // 实时输出
            if (config.verbose) {
                const status = result.passed ? '✅' : (result.isCritical ? '❌' : '⚠️');
                console.log(`${status} [${testCase.id}] "${testCase.input.slice(0, 20)}..." → ${result.latency?.toFixed(0) || 'N/A'}ms`);
            }

            // 防止 API 限流
            await this.delay(config.component === 'router' ? 150 : 100);
        }

        // 生成报告
        const report = this.buildReport(results, suite, config);

        // 输出结果
        if (config.outputFormat === 'console') {
            console.log(this.reportGenerator.generateConsoleOutput(report));
        }

        return report;
    }

    /**
     * 执行单个测试用例
     */
    private async executeTest(testCase: TestCase, suite: ValidationSuite, config: ValidationConfig): Promise<TestResult> {
        const iterations = config.iterations || 1;
        const latencies: number[] = [];
        let finalResult: TestResult | null = null;

        for (let i = 0; i < iterations; i++) {
            const start = Date.now();
            const result = await suite.run(testCase, config);
            result.latency = Date.now() - start;
            latencies.push(result.latency);

            // 多次迭代取最后一次结果
            finalResult = result;
        }

        // 平均延迟
        if (iterations > 1 && finalResult) {
            finalResult.latency = latencies.reduce((a, b) => a + b, 0) / latencies.length;
        }

        return finalResult!;
    }

    /**
     * 执行全量验证
     */
    async runFullValidation(config?: Partial<ValidationConfig>): Promise<ValidationReport[]> {
        const components: ValidationComponent[] = ['router', 'slc', 'sle', 'canvas', 'memory', 'watchdog'];
        const reports: ValidationReport[] = [];

        console.log('\n🚀 Running Full Validation (All Components)');
        console.log('='.repeat(60));

        for (const component of components) {
            const fullConfig: ValidationConfig = {
                component,
                outputFormat: 'markdown',
                strict: true,
                verbose: true,
                ...config
            };

            try {
                const report = await this.runComponentValidation(fullConfig);
                reports.push(report);

                // 保存报告
                this.reportGenerator.saveReport(report, 'markdown');
            } catch (e: any) {
                console.error(`❌ Failed to validate ${component}: ${e.message}`);
            }
        }

        return reports;
    }

    /**
     * 执行 P0 回归验证
     */
    async runP0Regression(config?: Partial<ValidationConfig>): Promise<boolean> {
        // 关键组件必须通过
        const criticalComponents: ValidationComponent[] = ['router', 'slc', 'sle'];

        console.log('\n🧪 Running P0 Regression Test');
        console.log('='.repeat(60));

        let allPassed = true;

        for (const component of criticalComponents) {
            const fullConfig: ValidationConfig = {
                component,
                outputFormat: 'console',
                strict: true,
                verbose: false,
                ...config
            };

            try {
                const report = await this.runComponentValidation(fullConfig);

                if (!report.passed) {
                    console.error(`❌ P0 Failed: ${component}`);
                    allPassed = false;
                } else {
                    console.log(`✅ P0 Passed: ${component}`);
                }
            } catch (e: any) {
                console.error(`❌ P0 Error: ${component} - ${e.message}`);
                allPassed = false;
            }
        }

        console.log('='.repeat(60));
        console.log(`P0 Regression Result: ${allPassed ? '✅ PASSED' : '❌ FAILED'}`);

        return allPassed;
    }

    /**
     * 加载测试套件
     */
    private async loadTestSuite(component: ValidationComponent): Promise<ValidationSuite> {
        // 动态加载组件测试套件
        const suiteMap: Record<ValidationComponent, string> = {
            router: './router/accuracy',
            slc: './slc/ttft',
            sle: './sle/tool-execution',
            canvas: './canvas/concurrency',
            memory: './memory/archive',
            watchdog: './watchdog/cleanup',
            integrated: './integrated/e2e'
        };

        try {
            const module = await require(suiteMap[component]);
            return module.getValidationSuite();
        } catch (e) {
            // 如果模块不存在，返回空套件
            console.warn(`⚠️ No validation suite found for ${component}, using empty suite`);
            return {
                name: `${component}-validation`,
                component,
                testCases: [],
                standard: VALIDATION_STANDARDS[component],
                run: async () => ({ testCaseId: '', passed: true, isCritical: false, isAcceptable: false, expected: null, actual: null })
            };
        }
    }

    /**
     * 构建验证报告
     */
    private buildReport(results: TestResult[], suite: ValidationSuite, config: ValidationConfig): ValidationReport {
        const passed = results.filter(r => r.passed);
        const failed = results.filter(r => !r.passed);
        const critical = results.filter(r => r.isCritical);
        const acceptable = results.filter(r => !r.passed && r.isAcceptable);

        // 计算准确率
        const strictAccuracy = (passed.length / results.length) * 100;
        const tolerantAccuracy = ((passed.length + acceptable.length) / results.length) * 100;

        // 计算延迟
        const latencies = results.map(r => r.latency || 0).filter(l => l > 0);
        const avgLatency = latencies.length > 0 ? latencies.reduce((a, b) => a + b, 0) / latencies.length : 0;
        const sortedLatencies = [...latencies].sort((a, b) => a - b);
        const p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)] || avgLatency;

        // 分类统计
        const categoryBreakdown: Record<string, any> = {};
        for (const result of results) {
            const cat = result.testCaseId.split('-')[0];
            if (!categoryBreakdown[cat]) {
                categoryBreakdown[cat] = { total: 0, passed: 0, failed: 0, critical: 0, acceptable: 0 };
            }
            categoryBreakdown[cat].total++;
            if (result.passed) categoryBreakdown[cat].passed++;
            else categoryBreakdown[cat].failed++;
            if (result.isCritical) categoryBreakdown[cat].critical++;
            if (result.isAcceptable) categoryBreakdown[cat].acceptable++;
        }

        // 计算分类准确率
        for (const cat of Object.keys(categoryBreakdown)) {
            const stats = categoryBreakdown[cat];
            stats.accuracy = (stats.passed + stats.acceptable) / stats.total * 100;
        }

        // 失败详情
        const failures = failed.map(r => ({
            testCaseId: r.testCaseId,
            input: suite.testCases.find(t => t.id === r.testCaseId)?.input || '',
            expected: r.expected,
            actual: r.actual,
            reason: r.reason || '',
            isCritical: r.isCritical,
            isAcceptable: r.isAcceptable,
            category: r.testCaseId.split('-')[0],
            latency: r.latency
        }));

        // 检查是否达标
        const standard = suite.standard;
        let isPassed = true;

        for (const [key, metricStandard] of Object.entries(standard.metrics)) {
            if (metricStandard.required) {
                const value = this.getMetricValue(key, { strictAccuracy, tolerantAccuracy, avgLatency, p95Latency, criticalFailures: critical.length });
                if (!this.checkMetric(value, metricStandard)) {
                    isPassed = false;
                    break;
                }
            }
        }

        return {
            component: config.component,
            timestamp: new Date().toISOString(),
            version: this.getVersion(),
            model: config.model,
            testSuite: suite.name,
            totalCases: results.length,
            metrics: {
                strictAccuracy,
                tolerantAccuracy,
                criticalFailures: critical.length,
                avgLatency,
                p95Latency
            },
            categoryBreakdown,
            failures,
            passed: isPassed,
            environment: {
                nodeVersion: process.version,
                platform: `${os.type()} ${os.release()}`,
                configOverrides: config
            }
        };
    }

    /**
     * 获取指标值
     */
    private getMetricValue(key: string, metrics: any): number {
        return metrics[key] || 0;
    }

    /**
     * 检查指标是否达标
     */
    private checkMetric(value: number, standard: { threshold: number; operator: string }): boolean {
        switch (standard.operator) {
            case 'gte': return value >= standard.threshold;
            case 'lte': return value <= standard.threshold;
            case 'eq': return value === standard.threshold;
            default: return value >= standard.threshold;
        }
    }

    /**
     * 获取版本号
     */
    private getVersion(): string {
        try {
            const pkg = require('../../package.json');
            return pkg.version || 'unknown';
        } catch {
            return 'unknown';
        }
    }

    /**
     * 延迟函数
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}