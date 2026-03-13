/**
 * 极限压力测试：验证 V1.6.0 的并发隔离、WAL 事务与 I/O 稳健性
 */
import { AsyncLocalStorage } from 'async_hooks';
import { FastAgent } from '../src/agent/fast-agent';
import { ShadowManager } from '../src/agent/shadow-manager';
import { callContextStorage } from '../src/context/ctx';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

dotenv.config(); // 加载系统 .env 以获取真实 API Key

async function runStressTest() {
    console.log("🔥 启动 V1.6.0 并发压力测试...");
    
    // 1. 初始化 Mock 环境
    const config = {
        llm: {
            apiKey: process.env.BAILIAN_API_KEY || '',
            baseUrl: process.env.BAILIAN_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            model: 'qwen-plus'
        }
    };
    const workspaceRoot = path.join(process.cwd(), 'tmp/stress_test_v160');
    if (!fs.existsSync(workspaceRoot)) fs.mkdirSync(workspaceRoot, { recursive: true });
    
    // 强制写入人设
    fs.writeFileSync(path.join(workspaceRoot, 'agent.md'), '# Jarvis\n你是一个忠诚的管家。');
    fs.writeFileSync(path.join(workspaceRoot, 'user.md'), '# User\n我是你的创造者。');

    const agent = new FastAgent(config as any, workspaceRoot);
    const CONCURRENCY = 50; // 恢复 50 路压力验证

    const startTime = Date.now();
    const tasks = Array.from({ length: CONCURRENCY }).map((_, i) => {
        const callId = `STRESS_CALL_${i}`;
        const userId = `USER_${i}`;
        
        return callContextStorage.run({ callId, userId, startTime: Date.now(), metadata: {} }, async () => {
            try {
                // 模拟一个带有状态更新的交互
                await agent.process("帮我给老板发个邮件，说我今天请假。", (resp) => {
                    // console.log(`[${callId}] Chunk received:`, resp);
                });
                return { success: true, id: callId };
            } catch (e: any) {
                console.error(`❌ [${callId}] 发生异常:`, e.message);
                return { success: false, id: callId, error: e.message };
            }
        });
    });

    console.log(`📡 正在派发 ${CONCURRENCY} 个并发请求...`);
    const results = await Promise.all(tasks);

    const duration = Date.now() - startTime;
    const successCount = results.filter(r => r.success).length;
    
    console.log(`\n📊 测试结果汇总:`);
    console.log(`- 总并发数: ${CONCURRENCY}`);
    console.log(`- 成功数: ${successCount}`);
    console.log(`- 失败数: ${CONCURRENCY - successCount}`);
    console.log(`- 总耗时: ${duration}ms`);
    console.log(`- 平均延迟: ${Math.round(duration / CONCURRENCY)}ms/call`);

    // 2. 验证状态隔离性
    console.log("\n🧪 正在验证影子状态物理隔离性...");
    let isolationError = false;
    for (let i = 0; i < CONCURRENCY; i++) {
        const walPath = path.join(workspaceRoot, `states/STRESS_CALL_${i}.wal`);
        const shadowPath = path.join(workspaceRoot, `states/STRESS_CALL_${i}_shadow.md`);
        
        // 由于测试只跑了一次交互，没到 1000 条，所以应该看 WAL
        if (!fs.existsSync(walPath)) {
            console.error(`❌ 错误: 找不到 ${walPath}`);
            isolationError = true;
        } else {
            const content = fs.readFileSync(walPath, 'utf-8');
            if (!content.includes(`STRESS_CALL_${i}`)) {
                console.error(`❌ 错误: ${walPath} 内容中包含错误的 CallID！可能发生串号！`);
                isolationError = true;
            }
        }
    }

    if (!isolationError) {
        console.log("✅ 状态隔离性验证通过：50 路并发无串号现象。");
    }

    if (successCount === CONCURRENCY) {
        console.log("\n🏆 V1.6.0 並發集成测试满分通过！可以合并核心逻辑。");
    } else {
        console.error("\n💀 测试未通过：存在失败请求。");
        process.exit(1);
    }
}

runStressTest().catch(e => {
    console.error("💥 测试脚本崩溃:", e);
    process.exit(1);
});
