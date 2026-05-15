import { DialogueMemory } from '../src/agent/dialogue-memory';
import { PromptAssembler } from '../src/agent/prompt-assembler';
import { CanvasManager } from '../src/agent/canvas-manager';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log('--- [Agent 2B] Verifying Archive Injection ---');
    const workspaceRoot = process.cwd();
    const memoryDir = path.join(workspaceRoot, 'memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir);

    const date = new Date().toISOString().split('T')[0];
    const logFile = path.join(memoryDir, `${date}.jsonl`);
    
    // 1. 预写入 2 条 TASK_ARCHIVED 事件
    const archivedEvent1 = {
        timestamp: Date.now() - 300000, // 5 mins ago
        callId: 'test-call',
        event: 'TASK_ARCHIVED',
        payload: { id: 't_001', name: '查广州天气', summary: '查询结果显示广州今天台风红色预警。' }
    };
    const archivedEvent2 = {
        timestamp: Date.now() - 60000, // 1 min ago
        callId: 'test-call',
        event: 'TASK_ARCHIVED',
        payload: { id: 't_002', name: '定闹钟', summary: '已为您设置明天早上 8 点的闹钟。' }
    };

    fs.writeFileSync(logFile, JSON.stringify(archivedEvent1) + '\n' + JSON.stringify(archivedEvent2) + '\n');

    const dialogueMemory = new DialogueMemory(workspaceRoot);
    const canvasManager = new CanvasManager(workspaceRoot);
    const assembler = new PromptAssembler(workspaceRoot, dialogueMemory, canvasManager);

    // 2. 构造 ROUTING Payload
    const payload = await assembler.assembleSLEPayload('ROUTING', 'test-call', { text: '刚才广州天气怎么说？' });
    const systemContent = payload[0].content;
    const userContent = payload[1].content;

    console.log('DEBUG systemContent length:', systemContent.length);
    console.log('DEBUG match 1:', systemContent.includes('isAnswerInArchiveMemory=true'));
    console.log('DEBUG match 2:', systemContent.includes('绝对禁止'));
    // console.log('DEBUG systemContent:', systemContent);
    if (!systemContent.includes('【Archive Memory 最近归档记忆索引】')) throw new Error('Missing Archive Memory header');
    if (!systemContent.includes('[Task ID: t_001] "查广州天气"')) throw new Error('Missing archived task 1 ID/Name');
    if (!systemContent.includes('查询结果显示广州今天台风红色预警。')) throw new Error('Missing archived task 1 summary');
    if (!systemContent.includes('5分钟前归档')) throw new Error('Incorrect time format');
    
    console.log('Checking rule 4 in system prompt...');
    if (!systemContent.includes('isAnswerInArchiveMemory=true')) throw new Error('Missing Archive match rule');
    if (!systemContent.includes('**绝对禁止**针对此类情况重新发起')) throw new Error('Missing prohibition rule');

    console.log('Checking user message content...');
    if (userContent.includes('{') || userContent.includes('tasks')) throw new Error('User message should be clean text');

    // 3. 构造无归档的 ROUTING Payload
    fs.unlinkSync(logFile);
    const payloadEmpty = await assembler.assembleSLEPayload('ROUTING', 'test-call', { text: '你好' });
    const systemEmpty = payloadEmpty[0].content;
    if (!systemEmpty.includes('【Archive Memory 最近归档记忆索引】\n(无)')) throw new Error('Empty archive should show (无)');

    console.log('✅ Archive Injection Verification Passed!');
    process.exit(0);
}

verify().catch(e => {
    console.error('❌ Verification Failed:', e);
    process.exit(1);
});
