/**
 * 模拟主 Agent 完成任务后的回调脚本
 * 使用方法: node scripts/trigger-callback.js "代码已经重构完成，性能提升了 30%"
 */

const text = process.argv[2] || "任务已处理完毕，请查收。";

async function trigger() {
    try {
        const res = await fetch('http://localhost:18789/voice/mock-callback', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                text: text,
                status: 'success',
                userId: 'test_user_001' // 占位符
            })
        });
        const data = await res.json();
        console.log('Successfully triggered notification:', data);
    } catch (e) {
        console.error('Failed to trigger:', e.message);
    }
}

trigger();
