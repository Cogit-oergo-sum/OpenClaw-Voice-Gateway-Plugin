/**
 * Fast Agent 验证框架 - 报告生成器
 *
 * 支持生成 Console、JSON、Markdown 三种格式的验证报告
 */

import { ValidationReport, ValidationMetrics, CategoryStats, FailureDetail, ValidationStandard, VALIDATION_STANDARDS } from './types';
import * as fs from 'fs';
import * as path from 'path';

export class ReportGenerator {
    /**
     * 生成 Markdown 格式报告
     */
    generateMarkdown(report: ValidationReport): string {
        const lines: string[] = [];

        // 标题
        lines.push(`# ${this.getComponentName(report.component)} Validation Report`);
        lines.push('');
        lines.push(`**Timestamp**: ${report.timestamp}`);
        lines.push(`**Version**: ${report.version}`);
        if (report.model) lines.push(`**Model**: ${report.model}`);
        lines.push(`**Test Suite**: ${report.testSuite} (${report.totalCases} cases)`);
        lines.push('');

        // Metrics Summary
        lines.push('## Metrics Summary');
        lines.push('');
        lines.push('| Metric | Value | Threshold | Status |');
        lines.push('|--------|-------|-----------|--------|');

        const standard = VALIDATION_STANDARDS[report.component];
        for (const [key, value] of Object.entries(report.metrics)) {
            if (value !== undefined && standard?.metrics[key]) {
                const metricStandard = standard.metrics[key];
                const threshold = metricStandard.threshold;
                const required = metricStandard.required ? '✓' : '';
                const status = this.checkThreshold(value, metricStandard);
                lines.push(`| ${metricStandard.description} | ${this.formatValue(key, value)} | ${this.formatThreshold(key, threshold)} ${required} | ${status} |`);
            }
        }
        lines.push('');

        // Category Breakdown
        lines.push('## Category Breakdown');
        lines.push('');
        lines.push('| Category | Passed | Failed | Critical | Accuracy | Status |');
        lines.push('|----------|--------|--------|----------|----------|--------|');

        for (const [cat, stats] of Object.entries(report.categoryBreakdown)) {
            const status = stats.critical === 0 ? '✅' : (stats.critical < 3 ? '⚠️' : '❌');
            lines.push(`| ${cat} | ${stats.passed}/${stats.total} | ${stats.failed} | ${stats.critical} | ${stats.accuracy.toFixed(1)}% | ${status} |`);
        }
        lines.push('');

        // Failures
        if (report.failures.length > 0) {
            lines.push('## Failures');
            lines.push('');

            const critical = report.failures.filter(f => f.isCritical);
            const acceptable = report.failures.filter(f => !f.isCritical && f.isAcceptable);
            const unexpected = report.failures.filter(f => !f.isCritical && !f.isAcceptable);

            if (critical.length > 0) {
                lines.push('### ❌ Critical Failures (关键失败)');
                lines.push('');
                for (const f of critical) {
                    lines.push(`- **[${f.testCaseId}]** "${f.input}"`);
                    lines.push(`  - ${f.reason}`);
                    if (f.latency) lines.push(`  - Latency: ${f.latency}ms`);
                }
                lines.push('');
            }

            if (unexpected.length > 0) {
                lines.push('### ⚠️ Unexpected Failures (非预期失败)');
                lines.push('');
                for (const f of unexpected) {
                    lines.push(`- **[${f.testCaseId}]** "${f.input}"`);
                    lines.push(`  - ${f.reason}`);
                }
                lines.push('');
            }

            if (acceptable.length > 0) {
                lines.push('### ✓ Acceptable Failures (可接受误判)');
                lines.push('');
                for (const f of acceptable) {
                    lines.push(`- **[${f.testCaseId}]** "${f.input}" - ${f.reason}`);
                }
            }
        }

        // Result
        lines.push('---');
        lines.push('');
        lines.push(`**Result**: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);

        // Environment info
        lines.push('');
        lines.push('---');
        lines.push('');
        lines.push('**Environment**:');
        lines.push(`- Node: ${report.environment.nodeVersion}`);
        lines.push(`- Platform: ${report.environment.platform}`);
        if (report.environment.configOverrides) {
            lines.push(`- Config Overrides: ${JSON.stringify(report.environment.configOverrides)}`);
        }

        return lines.join('\n');
    }

    /**
     * 生成 Console 输出（实时进度）
     */
    generateConsoleOutput(report: ValidationReport): string {
        const lines: string[] = [];

        lines.push('');
        lines.push('='.repeat(60));
        lines.push(`${this.getComponentName(report.component)} Validation Report`);
        lines.push('='.repeat(60));
        lines.push(`Timestamp: ${report.timestamp}`);
        if (report.model) lines.push(`Model: ${report.model}`);
        lines.push('');

        // Metrics
        lines.push('📊 Metrics Summary:');
        for (const [key, value] of Object.entries(report.metrics)) {
            if (value !== undefined) {
                const standard = VALIDATION_STANDARDS[report.component]?.metrics[key];
                if (standard) {
                    const status = this.checkThreshold(value, standard);
                    lines.push(`  ${standard.description}: ${this.formatValue(key, value)} ${status}`);
                }
            }
        }
        lines.push('');

        // Categories
        lines.push('📈 Category Breakdown:');
        for (const [cat, stats] of Object.entries(report.categoryBreakdown)) {
            const status = stats.critical === 0 ? '✅' : '❌';
            lines.push(`  ${cat}: ${stats.passed}/${stats.total} (${stats.accuracy.toFixed(1)}%) ${status}`);
        }
        lines.push('');

        // Critical failures
        const critical = report.failures.filter(f => f.isCritical);
        if (critical.length > 0) {
            lines.push('❌ Critical Failures:');
            for (const f of critical) {
                lines.push(`  [${f.testCaseId}] "${f.input}" → ${f.reason}`);
            }
            lines.push('');
        }

        // Final result
        lines.push('='.repeat(60));
        lines.push(`Result: ${report.passed ? '✅ PASSED' : '❌ FAILED'}`);
        lines.push('='.repeat(60));

        return lines.join('\n');
    }

    /**
     * 生成 JSON 格式报告
     */
    generateJson(report: ValidationReport): string {
        return JSON.stringify(report, null, 2);
    }

    /**
     * 保存报告到文件
     */
    saveReport(report: ValidationReport, format: 'markdown' | 'json'): string {
        const outputDir = path.join('doc', 'validation', 'reports', report.component);

        // 确保目录存在
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // 生成文件名
        const timestamp = new Date().toISOString().split('T')[0];
        const modelSuffix = report.model ? `_${report.model.replace(/[^a-zA-Z0-9]/g, '-')}` : '';
        const filename = `${timestamp}${modelSuffix}.${format === 'markdown' ? 'md' : 'json'}`;
        const filepath = path.join(outputDir, filename);

        // 写入内容
        const content = format === 'markdown'
            ? this.generateMarkdown(report)
            : this.generateJson(report);
        fs.writeFileSync(filepath, content);

        // 更新 latest 报告
        const latestPath = path.join(outputDir, 'latest.md');
        fs.writeFileSync(latestPath, this.generateMarkdown(report));

        return filepath;
    }

    /**
     * 获取组件名称（中文）
     */
    private getComponentName(component: string): string {
        const names: Record<string, string> = {
            router: 'IntentRouter',
            slc: 'SLC (Soul-Light-Chat)',
            sle: 'SLE (Soul-Logic-Expert)',
            canvas: 'CanvasManager',
            memory: 'DialogueMemory',
            watchdog: 'Watchdog',
            integrated: 'Integrated Validation'
        };
        return names[component] || component;
    }

    /**
     * 检查阈值是否达标
     */
    private checkThreshold(value: number, standard: { threshold: number; operator: string }): string {
        const { threshold, operator } = standard;

        let passed = false;
        switch (operator) {
            case 'gte': passed = value >= threshold; break;
            case 'lte': passed = value <= threshold; break;
            case 'eq': passed = value === threshold; break;
            default: passed = value >= threshold;
        }

        return passed ? '✅ PASS' : '❌ FAIL';
    }

    /**
     * 格式化数值显示
     */
    private formatValue(key: string, value: number): string {
        if (key.includes('Latency') || key === 'ttft') {
            return `${value.toFixed(0)}ms`;
        }
        if (key.includes('Rate') || key.includes('Accuracy')) {
            return `${value.toFixed(1)}%`;
        }
        return `${value}`;
    }

    /**
     * 格式化阈值显示
     */
    private formatThreshold(key: string, threshold: number): string {
        const standard = VALIDATION_STANDARDS['router' as keyof typeof VALIDATION_STANDARDS]?.metrics[key];
        if (!standard) return `${threshold}`;

        switch (standard.operator) {
            case 'gte': return `≥${threshold}`;
            case 'lte': return `≤${threshold}`;
            case 'eq': return `=${threshold}`;
            default: return `${threshold}`;
        }
    }
}