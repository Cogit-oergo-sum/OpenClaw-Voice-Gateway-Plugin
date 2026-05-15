import { buildShadowThought, ShadowThoughtType } from '../src/agent/prompts';
import { TaskItem } from '../src/agent/types';

// Mocking TaskItems
const task1: TaskItem = {
    id: 't_01',
    name: '读取报告',
    status: 'COMPLETED',
    summary: '结论是下周二架构评审',
    direct_response: '报告说下周二评审',
    importance_score: 10,
    is_delivered: false,
    created_at: Date.now(),
    version: 1
};

const task2: TaskItem = {
    id: 't_02',
    name: '归档PDF',
    status: 'COMPLETED',
    summary: '15个文件已归档',
    importance_score: 5,
    is_delivered: false,
    created_at: Date.now(),
    version: 1
};

const taskPending: TaskItem = {
    id: 't_03',
    name: '天气查询',
    status: 'PENDING',
    stage: 'WAITING_API',
    progress_detail: '正在调用天气接口',
    summary: '',
    importance_score: 5,
    is_delivered: false,
    created_at: Date.now(),
    version: 1
};

function test_buildShadowThought() {
    console.log('--- Testing buildShadowThought ---');

    // 1. RESULT_DELIVERY with 2 completed tasks
    const delivery = buildShadowThought('RESULT_DELIVERY', [task1, task2]);
    console.log('RESULT_DELIVERY:', delivery);
    if (!delivery.includes('读取报告') || !delivery.includes('下周二评审') || !delivery.includes('15个文件已归档')) {
        throw new Error('RESULT_DELIVERY logic failed');
    }

    // 2. PROGRESS_REPORT with pending task
    const progress = buildShadowThought('PROGRESS_REPORT', [taskPending]);
    console.log('PROGRESS_REPORT:', progress);
    if (!progress.includes('正在调用天气接口')) {
        throw new Error('PROGRESS_REPORT logic failed');
    }

    // 3. chat with matched tasks
    const chat = buildShadowThought('chat', [task1]);
    console.log('chat:', chat);
    if (!chat.includes('[t_01]') || !chat.includes('读取报告')) {
        throw new Error('chat logic failed');
    }

    // 4. Fallback
    const fallback = buildShadowThought('RESULT_DELIVERY', []);
    console.log('Fallback:', fallback);
    if (!fallback.includes('回应用户')) {
        throw new Error('Fallback logic failed');
    }

    console.log('✅ buildShadowThought tests passed!');
}

async function run_all() {
    try {
        test_buildShadowThought();
        console.log('All tests passed!');
        process.exit(0);
    } catch (e) {
        console.error('❌ Test failed:', e);
        process.exit(1);
    }
}

run_all();
