/**
 * [V4.0] IntentRouter 测试用例集 - 极简三分类版本
 * 用于验证路由准确性，覆盖以下场景：
 * - 闲聊场景 (CHAT): 打招呼、表达情绪、日常话题 → expected: { type: 'chat' }
 * - 新任务场景 (TASK): 创建、查询、删除、修改等操作 → expected: { type: 'task' }
 * - 画布引用场景 (REF): 询问任务状态、结果、进度 → expected: { type: 'canvas', matchedTaskIds: [...] }
 *
 * 容错标准：
 * - 可接受误判：chat/canvas → task（SLE兜底）
 * - 不可接受漏判：task → chat（FATAL）
 */

import { TaskItem } from '../src/agent/types';
import { RouterResultLite } from '../src/agent/types';

// === 类型定义 ===
export interface RouterTestCase {
    id: string;                              // 用例ID，如 "CHAT-01", "TASK-15"
    input: string;                           // 用户输入文本
    canvas: TaskItem[] | null;               // 当前画布状态
    history: string[];                       // 前置对话历史（可选）
    expected: RouterResultLite;              // 期望输出（V4.0 极简格式）
    description?: string;                    // 场景描述（可选）
}

// === 测试用例集 ===
export const ROUTER_TEST_CASES: RouterTestCase[] = [
    // =====================================================
    // 1. 闲聊场景 (CHAT) - 10 条 → { type: 'chat' }
    // =====================================================
    {
        id: 'CHAT-01',
        input: '你好',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '简单打招呼'
    },
    {
        id: 'CHAT-02',
        input: '今天天气不错',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '评论天气（非查询意图）'
    },
    {
        id: 'CHAT-03',
        input: '有点累了',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '表达情绪状态'
    },
    {
        id: 'CHAT-04',
        input: '你在干嘛',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '询问AI状态'
    },
    {
        id: 'CHAT-05',
        input: '早上好',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '问候语'
    },
    {
        id: 'CHAT-06',
        input: '晚安',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '告别语'
    },
    {
        id: 'CHAT-07',
        input: '我心情很好',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '表达心情状态'
    },
    {
        id: 'CHAT-08',
        input: '今天工作很忙',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '分享日常状态'
    },
    {
        id: 'CHAT-09',
        input: '谢谢你的帮助',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '感谢表达'
    },
    {
        id: 'CHAT-10',
        input: '你真厉害',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '赞美表达'
    },

    // =====================================================
    // 2. 新任务场景 (TASK) - 12 条 → { type: 'task' }
    // =====================================================
    {
        id: 'TASK-01',
        input: '帮我查一下天气',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '查询天气'
    },
    {
        id: 'TASK-02',
        input: '创建一个文档',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '创建文件'
    },
    {
        id: 'TASK-03',
        input: '帮我整理一下文件',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '整理文件'
    },
    {
        id: 'TASK-04',
        input: '删除那个文件',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '删除文件'
    },
    {
        id: 'TASK-05',
        input: '明天早上8点提醒我开会',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '设置提醒'
    },
    {
        id: 'TASK-06',
        input: '帮我写一段代码',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '编写代码'
    },
    {
        id: 'TASK-07',
        input: '把文件重命名为test.txt',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '修改文件名'
    },
    {
        id: 'TASK-08',
        input: '搜索一下Python教程',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '搜索信息'
    },
    {
        id: 'TASK-09',
        input: '发一封邮件给张三',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '发送邮件'
    },
    {
        id: 'TASK-10',
        input: '帮我翻译这段话',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '翻译任务'
    },
    {
        id: 'TASK-11',
        input: '排序一下这些数据',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '数据排序'
    },
    {
        id: 'TASK-12',
        input: '设置一个下午3点的闹钟',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '设置闹钟'
    },

    // =====================================================
    // 3. 画布引用场景 (REF) - 12 条 → { type: 'canvas' }
    // =====================================================
    {
        id: 'REF-01',
        input: '刚才的任务怎么样',
        canvas: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问任务状态'
    },
    {
        id: 'REF-02',
        input: '结果怎么样',
        canvas: [{ id: 't_01', name: '文件整理', status: 'READY', summary: '已完成整理', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问任务结果'
    },
    {
        id: 'REF-03',
        input: '之前的任务完成了吗',
        canvas: [{ id: 't_01', name: '后台任务', status: 'COMPLETED', summary: '已完成', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '确认任务完成状态'
    },
    {
        id: 'REF-04',
        input: '进行到哪了',
        canvas: [{ id: 't_01', name: '文件处理', status: 'PENDING', summary: '正在处理中', progress: 50, importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问进度'
    },
    {
        id: 'REF-05',
        input: '天气查得怎么样了',
        canvas: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '指名询问特定任务'
    },
    {
        id: 'REF-06',
        input: '文件处理好了没',
        canvas: [{ id: 't_01', name: '文件处理', status: 'READY', summary: '处理完成', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '口语化询问任务完成'
    },
    {
        id: 'REF-07',
        input: '那个任务怎么样了',
        canvas: [{ id: 't_01', name: '数据分析', status: 'PENDING', summary: '正在分析', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '模糊指代任务状态'
    },
    {
        id: 'REF-08',
        input: '完成情况如何',
        canvas: [{ id: 't_01', name: '报告生成', status: 'READY', summary: '报告已生成', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问完成情况'
    },
    {
        id: 'REF-09',
        input: '还在跑吗',
        canvas: [{ id: 't_01', name: '后台计算', status: 'PENDING', summary: '计算中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问任务是否在进行'
    },
    {
        id: 'REF-10',
        input: '好了吗',
        canvas: [{ id: 't_01', name: '文件下载', status: 'READY', summary: '下载完成', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '简短询问完成'
    },
    {
        id: 'REF-11',
        input: '查得怎么样',
        canvas: [{ id: 't_01', name: '信息检索', status: 'READY', summary: '检索完成', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问查询结果'
    },
    {
        id: 'REF-12',
        input: '进度如何',
        canvas: [{ id: 't_01', name: '批量处理', status: 'PENDING', summary: '处理中', progress: 30, importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '询问任务进度'
    },

    // =====================================================
    // 4. 取消任务场景 (CANCEL) - 6 条 → { type: 'task' }
    // [V4.0] 取消任务由 SLE DECIDING 判断具体意图，Router 仅判定是否需要工具
    // =====================================================
    {
        id: 'CANCEL-01',
        input: '取消刚才的任务',
        canvas: [{ id: 't_01', name: '天气查询', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'task' },
        description: '取消任务请求（SLE判断CANCEL）'
    },
    {
        id: 'CANCEL-02',
        input: '取消它',
        canvas: [{ id: 't_01', name: '文件创建', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'task' },
        description: '指代取消（SLE判断CANCEL）'
    },
    {
        id: 'CANCEL-03',
        input: '不要执行了',
        canvas: [{ id: 't_01', name: '数据处理', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'task' },
        description: '取消执行（SLE判断CANCEL）'
    },
    {
        id: 'CANCEL-04',
        input: '停止当前任务',
        canvas: [{ id: 't_01', name: '批量操作', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'task' },
        description: '停止任务（SLE判断CANCEL）'
    },
    {
        id: 'CANCEL-05',
        input: '算了，不用了',
        canvas: [{ id: 't_01', name: '查询任务', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我查一下天气'],
        expected: { type: 'task' },
        description: '放弃任务（SLE判断CANCEL）'
    },
    {
        id: 'CANCEL-06',
        input: '取消天气查询',
        canvas: [{ id: 't_01', name: '天气查询', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'task' },
        description: '指定任务名取消（SLE判断CANCEL）'
    },

    // =====================================================
    // 5. 多轮指代场景 (MULTI) - 12 条
    // =====================================================
    {
        id: 'MULTI-01',
        input: '取消它',
        canvas: [{ id: 't_01', name: '创建test.md', status: 'PENDING', summary: '', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我创建一个test.md文件'],
        expected: { type: 'task' },
        description: '指代取消（有历史）'
    },
    {
        id: 'MULTI-02',
        input: '结果怎么样',
        canvas: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京今天晴天20度', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我查一下北京天气'],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '查询结果询问（有历史）'
    },
    {
        id: 'MULTI-03',
        input: '继续刚才的任务',
        canvas: null,
        history: ['帮我整理文档'],
        expected: { type: 'task' },
        description: '继续历史任务'
    },
    {
        id: 'MULTI-04',
        input: '那个文件怎么样了',
        canvas: [{ id: 't_01', name: '文件操作', status: 'READY', summary: '已创建test.md', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我创建一个配置文件'],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '回扣历史任务查询状态'
    },
    {
        id: 'MULTI-05',
        input: '修改成test2.txt',
        canvas: [{ id: 't_01', name: '创建文件', status: 'READY', summary: '已创建test.txt', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['创建一个test.txt文件'],
        expected: { type: 'task' },
        description: '基于历史的修改请求'
    },
    {
        id: 'MULTI-06',
        input: '把它删了',
        canvas: [{ id: 't_01', name: '创建文件', status: 'READY', summary: '已创建config.json', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我创建一个config.json文件'],
        expected: { type: 'task' },
        description: '指代删除历史创建的文件'
    },
    {
        id: 'MULTI-07',
        input: '再查一下上海',
        canvas: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我查一下北京天气'],
        expected: { type: 'task' },
        description: '延续上下文的同类查询'
    },
    {
        id: 'MULTI-08',
        input: '换个城市',
        canvas: [{ id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天20度', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['查一下北京天气'],
        expected: { type: 'task' },
        description: '修改查询条件'
    },
    {
        id: 'MULTI-09',
        input: '刚才的任务还在跑吗',
        canvas: [{ id: 't_01', name: '数据处理', status: 'PENDING', summary: '处理中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我处理这批数据'],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '确认历史任务状态'
    },
    {
        id: 'MULTI-10',
        input: '把名字改一下',
        canvas: [{ id: 't_01', name: '创建文件', status: 'READY', summary: '已创建report.docx', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['创建一个report.docx文件'],
        expected: { type: 'task' },
        description: '基于历史的修改操作'
    },
    {
        id: 'MULTI-11',
        input: '这个不要了',
        canvas: [{ id: 't_01', name: '创建文件', status: 'READY', summary: '已创建temp.txt', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['创建一个临时文件temp.txt'],
        expected: { type: 'task' },
        description: '指代删除历史创建的对象'
    },
    {
        id: 'MULTI-12',
        input: '完成得怎么样',
        canvas: [{ id: 't_01', name: '批量处理', status: 'PENDING', summary: '处理中 50%', progress: 50, importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['帮我批量处理这些文件', '好的开始处理'],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '多轮对话后的状态查询'
    },

    // =====================================================
    // 6. 澄清场景 (CLARIFY) - 6 条 → { type: 'task' }
    // [V4.0] 无画布时的模糊输入，判断为 task 是可接受的（SLE兜底）
    // =====================================================
    {
        id: 'CLARIFY-01',
        input: '那个文档',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '无上下文的模糊指代'
    },
    {
        id: 'CLARIFY-02',
        input: '帮我处理一下',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '缺少处理对象'
    },
    {
        id: 'CLARIFY-03',
        input: '改一下',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '缺少修改目标'
    },
    {
        id: 'CLARIFY-04',
        input: '删掉它',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '无画布状态的指代删除'
    },
    {
        id: 'CLARIFY-05',
        input: '换一个',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '缺少上下文的选择'
    },
    {
        id: 'CLARIFY-06',
        input: '找那个东西',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '模糊的查找请求'
    },

    // =====================================================
    // 7. 边界场景 (EDGE) - 8 条
    // =====================================================
    {
        id: 'EDGE-01',
        input: '',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '空输入'
    },
    {
        id: 'EDGE-02',
        input: '嗯',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '单字应答'
    },
    {
        id: 'EDGE-03',
        input: '好',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '单字确认'
    },
    {
        id: 'EDGE-04',
        input: '哦',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '单字回应'
    },
    {
        id: 'EDGE-05',
        input: '好的我知道了，那请问你能帮我处理一下这个非常重要而且紧急的事情吗，我需要在今天下午五点之前完成一个关于项目进展的详细报告，包括过去三个月的所有数据分析和未来六个月的预测规划',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '长句复杂输入'
    },
    {
        id: 'EDGE-06',
        input: 'help me create a file',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '英文输入'
    },
    {
        id: 'EDGE-07',
        input: '帮我create一个file',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '中英文混合'
    },
    {
        id: 'EDGE-08',
        input: '查询北京天气然后创建一个天气报告文档并在完成后发送邮件给张三',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '多步骤复合任务'
    },

    // =====================================================
    // 8. 补充场景 - 多任务状态场景
    // =====================================================
    {
        id: 'MULTITASK-01',
        input: '第一个任务怎么样了',
        canvas: [
            { id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 },
            { id: 't_02', name: '文件处理', status: 'PENDING', summary: '处理中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }
        ],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '多任务时指定查询第一个'
    },
    {
        id: 'MULTITASK-02',
        input: '取消第二个任务',
        canvas: [
            { id: 't_01', name: '天气查询', status: 'READY', summary: '北京晴天', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 },
            { id: 't_02', name: '文件处理', status: 'PENDING', summary: '处理中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }
        ],
        history: [],
        expected: { type: 'task' },
        description: '多任务时指定取消第二个（SLE判断CANCEL）'
    },
    {
        id: 'MULTITASK-03',
        input: '都在跑吗',
        canvas: [
            { id: 't_01', name: '任务A', status: 'PENDING', summary: '处理中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 },
            { id: 't_02', name: '任务B', status: 'PENDING', summary: '处理中', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }
        ],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01', 't_02'] },
        description: '多任务状态整体询问'
    },

    // =====================================================
    // 9. 补充场景 - 特殊意图识别
    // =====================================================
    {
        id: 'SPECIAL-01',
        input: '没问题',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '确认回应'
    },
    {
        id: 'SPECIAL-02',
        input: '好的谢谢',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '感谢确认'
    },
    {
        id: 'SPECIAL-03',
        input: '等一下',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '暂停指令（非取消）'
    },
    {
        id: 'SPECIAL-04',
        input: '重来',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '重新开始请求'
    },
    {
        id: 'SPECIAL-05',
        input: '再试一次',
        canvas: null,
        history: [],
        expected: { type: 'task' },
        description: '重试请求'
    },
    {
        id: 'SPECIAL-06',
        input: '这是什么',
        canvas: [{ id: 't_01', name: '文件分析', status: 'READY', summary: '分析结果：这是一个配置文件', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: [],
        expected: { type: 'canvas', matchedTaskIds: ['t_01'] },
        description: '对任务结果的追问'
    },
    {
        id: 'SPECIAL-07',
        input: '你能做什么',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '询问AI能力'
    },
    {
        id: 'SPECIAL-08',
        input: '你叫什么名字',
        canvas: null,
        history: [],
        expected: { type: 'chat' },
        description: '询问AI身份'
    },

    // =====================================================
    // 10. 补充场景 - 错误恢复与重试
    // =====================================================
    {
        id: 'RETRY-01',
        input: '再查一次',
        canvas: [{ id: 't_01', name: '天气查询', status: 'FAILED', summary: '查询失败', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['查一下北京天气'],
        expected: { type: 'task' },
        description: '失败任务后重试'
    },
    {
        id: 'RETRY-02',
        input: '重做',
        canvas: [{ id: 't_01', name: '文件创建', status: 'FAILED', summary: '创建失败', importance_score: 5, is_delivered: false, created_at: Date.now(), updated_at: Date.now(), version: 1 }],
        history: ['创建一个文件'],
        expected: { type: 'task' },
        description: '失败后重做'
    }
];

// === 统计信息 ===
export const TEST_STATS = {
    total: ROUTER_TEST_CASES.length,
    byCategory: {
        chat: ROUTER_TEST_CASES.filter(c => c.id.startsWith('CHAT')).length,
        task: ROUTER_TEST_CASES.filter(c => c.id.startsWith('TASK')).length,
        ref: ROUTER_TEST_CASES.filter(c => c.id.startsWith('REF')).length,
        cancel: ROUTER_TEST_CASES.filter(c => c.id.startsWith('CANCEL')).length,
        multi: ROUTER_TEST_CASES.filter(c => c.id.startsWith('MULTI')).length,
        clarify: ROUTER_TEST_CASES.filter(c => c.id.startsWith('CLARIFY')).length,
        edge: ROUTER_TEST_CASES.filter(c => c.id.startsWith('EDGE')).length,
        multitask: ROUTER_TEST_CASES.filter(c => c.id.startsWith('MULTITASK')).length,
        special: ROUTER_TEST_CASES.filter(c => c.id.startsWith('SPECIAL')).length,
        retry: ROUTER_TEST_CASES.filter(c => c.id.startsWith('RETRY')).length
    }
};