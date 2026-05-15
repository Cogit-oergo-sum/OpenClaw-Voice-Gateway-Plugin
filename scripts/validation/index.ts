/**
 * Fast Agent 验证框架 - CLI 入口
 *
 * 支持的命令：
 * - npm run test:router          - IntentRouter 准确率验证
 * - npm run test:router:latency  - IntentRouter 延迟验证
 * - npm run test:slc             - SLC TTFT 验证
 * - npm run test:sle             - SLE 工具执行验证
 * - npm run test:all             - 全量验证
 * - npm run test:p0              - P0 回归验证
 * - npm run test:report          - 生成综合报告
 *
 * 命令行参数：
 * --model=qwen3-14b    指定模型
 * --iter=3             重复测试次数
 * --strict             严格模式（关键失败必须为0）
 * --verbose            详细输出
 * --json               JSON 格式输出
 * --report             生成并保存报告
 */

import * as dotenv from 'dotenv';
import { ValidationRunner } from './runner';
import { ReportGenerator } from './report-generator';
import { ValidationConfig, ValidationComponent } from './types';

dotenv.config();

// 解析命令行参数
const args = process.argv.slice(2);

function parseArgs(): ValidationConfig & { action: string } {
    const action = args.find(a => a.startsWith('--')) || '--component';

    // 提取组件名（第一个非 -- 开头的参数）
    const componentArg = args.find(a => !a.startsWith('--'));
    const component: ValidationComponent = (componentArg as ValidationComponent) || 'router';

    // 解析参数
    const modelArg = args.find(a => a.startsWith('--model='));
    const model = modelArg ? modelArg.split('=')[1] : process.env.ROUTER_MODEL || 'qwen-turbo';

    const iterArg = args.find(a => a.startsWith('--iter='));
    const iterations = iterArg ? parseInt(iterArg.split('=')[1]) : 1;

    const outputFormat = args.includes('--json') ? 'json' : 'console';

    return {
        action,
        component,
        model,
        iterations,
        outputFormat,
        strict: args.includes('--strict'),
        verbose: args.includes('--verbose') || iterations === 1,
        outputPath: args.find(a => a.startsWith('--output='))?.split('=')[1]
    };
}

async function main() {
    const config = parseArgs();
    const runner = new ValidationRunner();
    const generator = new ReportGenerator();

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║         Fast Agent Validation Framework                      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('');

    try {
        // 根据动作执行不同验证
        if (config.action === '--all' || args.includes('--all')) {
            // 全量验证
            const reports = await runner.runFullValidation(config);
            for (const report of reports) {
                const filepath = generator.saveReport(report, 'markdown');
                console.log(`📄 Report saved: ${filepath}`);
            }

        } else if (config.action === '--p0' || args.includes('--p0')) {
            // P0 回归
            const passed = await runner.runP0Regression(config);
            process.exit(passed ? 0 : 1);

        } else if (config.action === '--report' || args.includes('--report')) {
            // 生成报告
            const report = await runner.runComponentValidation({
                ...config,
                outputFormat: 'markdown',
                verbose: true
            });
            const filepath = generator.saveReport(report, 'markdown');
            console.log(`\n📄 Report saved: ${filepath}`);

            // 退出码
            if (config.strict && !report.passed) {
                process.exit(1);
            }
            process.exit(0);

        } else {
            // 单组件验证
            const report = await runner.runComponentValidation(config);

            // 输出结果
            if (config.outputFormat === 'json') {
                console.log(generator.generateJson(report));
            } else {
                console.log(generator.generateConsoleOutput(report));
            }

            // 保存报告（如果指定 --save）
            if (args.includes('--save')) {
                const filepath = generator.saveReport(report, 'markdown');
                console.log(`\n📄 Report saved: ${filepath}`);
            }

            // 退出码
            if (config.strict && !report.passed) {
                console.error('\n❌ Validation failed (strict mode)');
                process.exit(1);
            }

            console.log('\n✅ Validation completed');
            process.exit(0);
        }

    } catch (e: any) {
        console.error('');
        console.error('❌ FATAL ERROR:', e.message);
        console.error('');
        if (config.verbose) {
            console.error(e.stack);
        }
        process.exit(1);
    }
}

// 显示帮助信息
if (args.includes('--help') || args.includes('-h')) {
    console.log('');
    console.log('Usage: npm run test:<component> [options]');
    console.log('');
    console.log('Components:');
    console.log('  router          IntentRouter 准确率验证');
    console.log('  router:latency  IntentRouter 延迟验证');
    console.log('  slc             SLC TTFT 验证');
    console.log('  sle             SLE 工具执行验证');
    console.log('  canvas          CanvasManager 状态一致性验证');
    console.log('  memory          DialogueMemory 检索验证');
    console.log('  watchdog        Watchdog 任务清理验证');
    console.log('');
    console.log('Actions:');
    console.log('  --all           执行全量验证（所有组件）');
    console.log('  --p0            执行 P0 回归验证（关键组件）');
    console.log('  --report        生成并保存 Markdown 报告');
    console.log('');
    console.log('Options:');
    console.log('  --model=<name>  指定模型（如 qwen-turbo, qwen3-14b）');
    console.log('  --iter=<n>      重复测试次数（用于延迟测试）');
    console.log('  --strict        严格模式（关键失败必须为0）');
    console.log('  --verbose       详细输出每个测试用例');
    console.log('  --json          JSON 格式输出');
    console.log('  --save          保存报告到 doc/validation/reports/');
    console.log('');
    console.log('Examples:');
    console.log('  npm run test:router                        # IntentRouter 准确率验证');
    console.log('  npm run test:router --model=qwen3-14b      # 使用指定模型');
    console.log('  npm run test:router --strict --verbose     # 严格模式详细输出');
    console.log('  npm run test:router:latency --iter=3       # 延迟验证（3次迭代）');
    console.log('  npm run test:all --save                    # 全量验证并保存报告');
    console.log('  npm run test:p0                            # P0 回归验证');
    console.log('');
    process.exit(0);
}

main();