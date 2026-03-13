import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

const client = new OpenAI({
    apiKey: process.env.BAILIAN_API_KEY,
    baseURL: process.env.BAILIAN_BASE_URL
});

const model = process.env.BAILIAN_MODEL || 'qwen-plus';

const TEST_SCENARIOS = [
    "你好 Jarvis，今天感觉如何？",
    "帮我看看现在的 memory 模块有没有什么明显的死锁风险？",
    "哦对了，我刚才好像在 src/context 里改了点东西，帮我同步一下。",
    "你觉得 OpenClaw 的插件架构对于低延迟 RTC 来说，最大的短板在哪？",
    "帮我重构一下这个 memory 逻辑吧，我累了。",
    "我确实觉得很累，甚至想听个笑话。",
    "这个笑话不好笑，换一个更极客一点的。",
    "杭州现在下大雨了吗？我还要去参加 ZEGO 的技术沙龙。",
    "帮我查一下沙龙的地址在哪？",
    "算了，还是继续说重构的事，你刚才执行到哪了？",
    "如果我把 Redis 换成本地内存 LRU，延迟能降多少？",
    "帮我写一个简单的 LRU 实现 Demo 给我看。",
    "再帮我生成个单元测试，要包含各种边界情况。",
    "你觉得我的代码写得怎么样？说实话。",
    "先生，那如果我不想用 Rust 而是想用 C++ 呢？",
    "帮我把刚才的逻辑翻译成 C++20 的版本。",
    "记得加智能指针，别让我处理内存泄漏。",
    "如果现在系统突然 OOM 了，你会采取什么紧急策略？",
    "帮我模拟一个内存溢出的上报任务。",
    "这个任务完成后，记得发邮件给 Zego 的 architect 邮箱。",
    "等等，那个重构任务主 Agent 完成了吗？查询一下进度。",
    "我感觉你今天比平时反应快了，是因为我们改了并联架构吗？",
    "你这种架构设计，如果是面对海量并发请求，会有死锁吗？",
    "帮我分析下目前系统的最大并发 QPS 瓶颈。",
    "我打算在杭州买套房，你觉得哪里的程序员社区氛围比较好？",
    "那边的雨大吗？别又是淹了。",
    "帮我搜索一下余杭区的排水系统新闻。",
    "回到正事，把刚才的 C++ 代码打包发给主 Agent 审查。",
    "主 Agent 有反馈吗？",
    "帮我把目前的 Shadow MD 打包存盘。",
    "我想喝咖啡，告诉前台机器人帮我下一单瑞幸。",
    "要美式，不加糖。",
    "任务 ID 是多少？",
    "算了，咖啡的事别盯了。我们继续讨论 RTC 协议的丢包补偿。",
    "帮我查询一下 WebRTC 相关的 FEC 算法优化策略。",
    "这些策略能应用到我们的语音插件里吗？",
    "帮我起草一份关于音频降噪的 PRD 文档。",
    "文档标题定为：极致低延迟下的 AI 消噪模型引入指南。",
    "你在 PRD 里加上 VAD 阈值动态调整的逻辑。",
    "那个 memory 重构的 ID #1024 任务，现在进度多少了？",
    "帮我督促一下主 Agent，说用户正在等消息。",
    "我现在心情不太好，重构总是出 Bug。",
    "你能感知我的负面情绪吗？",
    "帮我把所有未完成的任务列个清单。",
    "把清单同步到我手机上的 OpenClaw App。",
    "我今天表现得是不是有点焦虑？",
    "没关系，我们把今天的成果做个总结报告吧。",
    "报告里要高度评价我们今天实现的并联接力架构。",
    "最后，帮我把刚才说的所有话都做个语义归纳存入 Shadow MD。",
    "晚安 Jarvis。",
    "早安 Jarvis，帮我解析一下昨晚存的那个 Shadow MD 归纳。",
    "有什么遗漏的关键决策吗？",
    "帮我把那个 C++ LRU Demo 增加一个线程池异步预热的功能。",
    "线程池的 worker 数量设置为 CPU 核心数 - 1。",
    "如果预热过程中主线程突然发起了 get 请求，怎么保证一致性？",
    "帮我写出这个并发控制逻辑的 C++ 代码。",
    "如果是用 Rust 的话，读写锁和原子引用计数怎么配合？",
    "帮我写一个 Rust 版本的并发预热逻辑。",
    "我打算在云栖小镇办个小型黑客马拉松，帮我起草个策划案。",
    "规模定在 30 人左右，主题是：RTC 网络协议的极致优化。",
    "帮我列一下需要的赞助商清单。",
    "ZEGO 肯定在里面，还有谁？",
    "对了，如果是下雨天，这个活动是不是得改室内？",
    "帮我查一下云栖小镇 2 号楼的备用室内空间。",
    "如果到时候突然断网了，有什么本地化协作工具推荐？",
    "帮我把这个黑马策划案同步给我的合伙人。",
    "合伙人的邮箱是 partner@openclaw.dev。",
    "刚才的任务 ID 记录了吗？",
    "我想确认下之前的 memory 重构是不是真的比本地 LRU 快？",
    "帮我跑一个综合性的 Bench 对比试验。",
    "把结果生成图表发给我。",
    "刚才我在代码里发现个奇怪的现象：锁竞争在并联模式下反而升高了，为什么？",
    "帮我分析一下瓶颈是不是回到了 aux_loop 调度上？",
    "如果增加一个 GPU 执行加速层，对这种纯 CPU 密集任务有提升吗？",
    "好的，那我们尝试一下 `rust-cuda` 的集成逻辑。",
    "帮我起草一个引入 CUDA 加速的 RFC 文档。",
    "你在 RFC 里加入内核分配策略（SMM vs LMM）。",
    "这个 RFC 的优先级设为 Medium。",
    "帮我向主 Agent 索取一份目前 OpenClaw 所有的 RFC 列表。",
    "查询到了吗？",
    "刚才提到的 C++ 智能指针，在 CUDA 核函数里能直接用吗？",
    "如果不能，帮我设计一个 CUDA 友好的智能指针替代方案。",
    "我今天有点累了，帮我读一段你刚才提到的「向你致意」的代码韵脚。",
    "那段诗是在哪一轮生成的？",
    "帮我汇总一下，我们今天一共优化了多少 ms 的延迟？",
    "你觉得我们离真正的「极速响应」目标还有多远？",
    "帮我把今天的测试日志全部脱敏后发送到我的备份邮箱。",
    "备份邮箱是 backup@zego.im。",
    "刚才那个瑞幸订单，前台机器人送到了吗？我还没去取。",
    "帮我催一下机器人，或者确认下格口状态。",
    "今天表现得很好，Jarvis。",
    "帮我把目前的系统负载状态存入 Shadow MD 的 snapshot。",
    "内存占用现在是多少？",
    "CPU 负载均衡吗？",
    "帮工在 PRD 里补充一个关于端侧推理量化的章节。",
    "量化精度要求 INT8，误差控制在 0.5% 以内。",
    "这个 PRD 的版本号定为 v1.2。",
    "帮我把这个版本推送到内部 Wiki。",
    "我们要不要再搞个彩蛋？输出一段二进制代码形式的「Jarvis 墓志铭」。",
    "开玩笑的。把刚才的成果封装成一个 Release Candidate。",
    "Release 名称叫：Jarvis-Speed-0.9.3-PRO。",
    "最后，再次帮我检查一下所有文件的 commit 状态。",
    "再会。"
];

function applyPhysicalInterceptor(filler: string, relayText: string): string {
    const fillerStub = filler.substring(0, 8).trim();
    if (relayText.trim().startsWith(fillerStub)) {
        const firstSpace = relayText.indexOf(' ', 10);
        return relayText.substring(firstSpace !== -1 ? firstSpace : 8).trim();
    }
    return relayText;
}

async function fetchWithRetry(fn: () => Promise<any>, retries = 3): Promise<any> {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === retries - 1) throw e;
            console.log(`Retry ${i + 1}/${retries} after error: ${e}`);
            await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        }
    }
}

async function runEnhancedStressTest() {
    const reportPath = path.join(process.cwd(), 'doc/relay_enhanced_stress_test_report.md');
    
    // 初始化报告文件
    let reportHeader = "# Jarvis 并联接力架构 (Parallel Relay) 100轮压力测试报告 (含物理拦截器验证)\n\n";
    reportHeader += `测试开始时间: ${new Date().toLocaleString()}\n`;
    reportHeader += `测试模型: ${model}\n\n`;
    reportHeader += "| 轮次 | 用户输入 | 抢跑垫话 (SLC-Chat) | 原始接力 (SLE-Raw) | 拦截器处理后 (Final) | 缝合评价 |\n";
    reportHeader += "| --- | --- | --- | --- | --- | --- |\n";
    fs.writeFileSync(reportPath, reportHeader);

    let history: any[] = [
        { role: 'system', content: '你是由 OpenClaw 驱动的极客助手 Jarvis。你是用户的顶级技术助理，忠诚、冷静、高情商，说话简洁有力。' }
    ];

    console.log(`🚀 开始 100 轮增强型压力测试仿真 (带物理拦截器)...`);

    for (let i = 0; i < TEST_SCENARIOS.length; i++) {
        const userInput = TEST_SCENARIOS[i];
        console.log(`[Turn ${i+1}/${TEST_SCENARIOS.length}] Processing: ${userInput}`);

        try {
            // 1. 模拟 SLC (Chat 流) 的抢跑回复
            const filler = await fetchWithRetry(async () => {
                const res = await client.chat.completions.create({
                    model: model,
                    messages: [
                        ...history,
                        { role: 'system', content: '[指令]: 你现在是一个极速反馈模块。请只说 1 句短小简洁的、符合 Jarvis 身份的高情商安抚语、确认语或垫话。不要给出答案。' },
                        { role: 'user', content: userInput }
                    ] as any
                });
                return res.choices[0].message.content || "";
            });

            // 2. 模拟工具状态
            const hasTool = userInput.includes('帮我') || userInput.includes('重构') || userInput.includes('查') || userInput.includes('写') || userInput.includes('执行');
            const toolFeedback = hasTool ? `[系统结果]: 行为 "${userInput.substring(0, 10).trim()}..." 的异步流水线已建立。` : "";

            // 3. 模拟 SLE (Logic 流) 的缝合回复
            const rawRelayText = await fetchWithRetry(async () => {
                const sleMessages = [
                    ...history,
                    { role: 'user', content: userInput },
                    { role: 'assistant', content: filler }
                ];
                if (hasTool) {
                    sleMessages.push({ role: 'system', content: toolFeedback });
                }
                const res = await client.chat.completions.create({
                    model: model,
                    messages: sleMessages as any
                });
                return res.choices[0].message.content || "";
            });

            // 4. 应用物理拦截器
            const finalRelayText = applyPhysicalInterceptor(filler, rawRelayText);

            // 语义评价逻辑
            let evaluation = "✅ 顺滑";
            if (rawRelayText.includes(filler.substring(0, 8))) {
                evaluation = `🛠️ 拦截生效 (原本包含复读)`;
            } else if (finalRelayText.length < 5) {
                evaluation = "⚠️ 回复受限";
            }

            const row = `| ${i+1} | ${userInput.replace(/\n/g, ' ')} | ${filler.replace(/\n/g, ' ')} | ${rawRelayText.substring(0, 30).replace(/\n/g, ' ')}... | ${finalRelayText.replace(/\n/g, ' ')} | ${evaluation} |\n`;
            fs.appendFileSync(reportPath, row);

            // 更新历史
            history.push({ role: 'user', content: userInput });
            history.push({ role: 'assistant', content: filler + " " + finalRelayText });

            // 限制 history 长度防止 token 超限
            if (history.length > 20) {
                history = [history[0], ...history.slice(-19)];
            }

        } catch (e) {
            console.error(`Fatal error at turn ${i+1}: ${e}`);
            fs.appendFileSync(reportPath, `\n\n**测试中断于第 ${i+1} 轮，由于致命错误: ${e}**\n`);
            break;
        }

        if (i % 5 === 0) await new Promise(r => setTimeout(r, 500));
    }

    console.log(`\n✅ 测试结束。报告已实时保存至: ${reportPath}`);
}

runEnhancedStressTest().catch(console.error);
