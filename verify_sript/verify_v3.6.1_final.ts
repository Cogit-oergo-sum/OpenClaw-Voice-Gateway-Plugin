import { execSync } from 'child_process';
import * as path from 'path';

async function runFinalRegression() {
    console.log("====================================================");
    console.log("🚀 [OpenClaw V3.6.1] Final Regression Verification");
    console.log("====================================================\n");

    const scripts = [
        'verify_v3.6.1_p1.ts', // Phase 1 & 3
        'verify_v3.6.1_p2.ts'  // Phase 2
    ];

    let allPassed = true;

    for (const script of scripts) {
        console.log(`\n▶️ Executing: ${script}...`);
        try {
            // 使用 npx ts-node 运行，因为脚本是 .ts
            const output = execSync(`npx ts-node ${script}`, { stdio: 'inherit' });
            console.log(`✅ ${script} PASSED.`);
        } catch (error) {
            console.error(`❌ ${script} FAILED!`);
            allPassed = false;
            // 如果一个失败，根据 CI 逻辑通常停止，但这里我们继续看总表
        }
    }

    console.log("\n====================================================");
    if (allPassed) {
        console.log("🎉 ALL V3.6.1 REGRESSION TESTS PASSED!");
        console.log("====================================================");
        process.exit(0);
    } else {
        console.error("⛔ REGRESSION TESTS FAILED. PLEASE CHECK LOGS.");
        console.log("====================================================");
        process.exit(1);
    }
}

runFinalRegression().catch(err => {
    console.error(err);
    process.exit(1);
});
