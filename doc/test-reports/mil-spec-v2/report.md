# Fast Agent 军规交互与性能验证报告 (MIL-SPEC V2)

测试时间: 3/17/2026, 3:16:26 PM
语速参考: 3 char/s

| 场景 ID | SLC TTFT | SLE TTFT | 物理冷场 (ms) | 最终回复 | 结论 |
| --- | --- | --- | --- | --- | --- |
| mil_01_emotion | 628ms | 1164ms | 0ms | 嗯。Zego，语音网关插件的 Fast Agent 延迟卡点... | EXCELLENT |
| mil_02_weather | 253ms | 6823ms | 1570ms | 噢？听着呢...听着呢...先生请放心，我盯着呢。有消息立刻... | FAIL |
| mil_03_load | 308ms | 1009ms | 0ms | 不在。没权限查实时负载。  
要不你贴个 `top` 或 `... | EXCELLENT |
| mil_04_dry_phone | 218ms | 7272ms | 0ms | 查不了。这样啊...这样啊...这样啊...先生请放心，我盯... | FATAL |
| mil_05_long_job | 219ms | 762ms | 0ms | 嗯。先看下 src/agent 的当前结构和并发瓶颈点在哪—... | EXCELLENT |
| mil_06_clarify | 279ms | 726ms | 0ms | 好的邮件内容？... | PASS |
| mil_07_jargon | 255ms | 796ms | 0ms | 嗯。没看到代码。发我看看。... | EXCELLENT |
| mil_08_slow_sle | 316ms | 902ms | 0ms | 嗯。π 的第 100 万位是 **1**。

（基于已验证的... | EXCELLENT |
| mil_09_greeting | 266ms | 855ms | 0ms | 先生。早安，Zego。  
Voice Gateway Pl... | EXCELLENT |
| mil_10_asr_error | 370ms | 788ms | 0ms | 不在。快递查不到收件人、手机号、快递单号，没法查。

西溪越... | FATAL |
| test_batch_1_01 | 336ms | 849ms | 0ms | 先生Zego，早。  
Voice Gateway Plug... | EXCELLENT |
| test_batch_1_02 | 303ms | 952ms | 0ms | 唉。代码写崩了？还是架构评审又被挑刺了？... | EXCELLENT |
| test_batch_1_03 | 292ms | 1319ms | 27ms | 嗯？我是 Zego 先生自己写的轻量级协程代理，没用大模型，... | EXCELLENT |
| test_batch_1_04 | 293ms | 1158ms | 0ms | 《影响力》《思考，快与慢》——卡尼曼。  
认知偏差、双系统... | EXCELLENT |
| test_batch_1_05 | 252ms | 1230ms | 0ms | 噢？3:18 PM... | FAIL |
| test_batch_1_06 | 323ms | 719ms | 0ms | 嗯。32768... | EXCELLENT |
| test_batch_1_07 | 211ms | 722ms | 0ms | 你好Bonjour le monde... | EXCELLENT |
| test_batch_1_08 | 416ms | 7754ms | 0ms | 不在。先生...稍等我看看...你说，我在听...先生请放心... | FATAL |
| test_batch_1_09 | 263ms | 1389ms | 0ms | 好的。番茄钟已设，10 分钟后提醒。... | FAIL |
| test_batch_1_10 | 264ms | 7123ms | 0ms | 查一下我在呢...这样啊...这样啊...先生请放心，我盯着... | FATAL |
| test_batch_1_11 | 322ms | 782ms | 0ms | 嗯。提醒已设好。... | EXCELLENT |
| test_batch_1_12 | 304ms | 1043ms | 0ms | 收到发站会邀请，时间固定：每周一 9:00。  
内容需要你... | EXCELLENT |
| test_batch_1_13 | 342ms | 872ms | 0ms | 收到短信发给谁？用哪家运营商通道？网站 URL 是？... | FAIL |
| test_batch_1_14 | 313ms | 977ms | 0ms | 收到续费订阅需要确认服务类型和支付方式。  
Zego，具体... | EXCELLENT |
| test_batch_1_15 | 216ms | 816ms | 0ms | 好的。备份目标路径和方式？Git push 还是 tar +... | EXCELLENT |
| test_batch_1_16 | 635ms | 1024ms | 0ms | 嗯。增量。  
Voice Gateway Plugin 的... | EXCELLENT |
| test_batch_1_17 | 254ms | 611ms | 0ms | 好的提醒时间改成明天早上 8 点？... | EXCELLENT |
| test_batch_1_18 | 264ms | 608ms | 0ms | 嗯。哪个汇率源？你没说具体是哪个。... | EXCELLENT |
| test_batch_1_19 | 217ms | 776ms | 0ms | 先生。备份失败通知谁？得看配置——是告警系统配的接收人，还是... | EXCELLENT |
| test_batch_1_20 | 304ms | 1201ms | 0ms | 嗯。无定时任务在运行。... | FAIL |
| test_batch_1_01 | 215ms | 933ms | 0ms | 嗯。嗯，Voice Gateway Plugin 的 1s ... | FAIL |
| test_batch_1_02 | 294ms | 1047ms | 0ms | 不好。听着呢...这样啊...北京天气，得查实时数据。

先... | FAIL |
| test_batch_1_03 | 296ms | 993ms | 0ms | 嗯？RTC 工程师写了个心跳包，结果对方没回 ACK——  ... | EXCELLENT |
| test_batch_1_04 | 304ms | 825ms | 0ms | 嗯。电影？不熟。  
你刚在搞 Voice Gateway ... | FAIL |
| test_batch_1_05 | 486ms | 746ms | 0ms | 唉。不会。  
AI 是工具，不是主体——它没意图、没生存欲... | EXCELLENT |
| test_batch_1_06 | 295ms | 843ms | 0ms | 好的。5 分钟倒计时启动。... | EXCELLENT |
| test_batch_1_07 | 395ms | 7335ms | 274ms | 嗯。先生...我在呢...我在呢...先生请放心，我盯着呢。... | FAIL |
| test_batch_1_08 | 224ms | 7741ms | 851ms | 不详这样啊...这样啊...先生...先生请放心，我盯着呢。... | FATAL |
| test_batch_1_09 | 221ms | 1029ms | 0ms | 嗯？7006652... | FAIL |
| test_batch_1_10 | 275ms | 796ms | 0ms | 请讲Hello, world... | FAIL |
| test_batch_1_11 | 214ms | 666ms | 0ms | 好的提醒设好了。... | EXCELLENT |
| test_batch_1_12 | 244ms | 739ms | 0ms | 好的设个每小时喝水提醒。... | FAIL |
| test_batch_1_13 | 295ms | 935ms | 0ms | 嗯。报警发给谁？用什么方式（钉钉/邮件/Webhook）？... | EXCELLENT |
| test_batch_1_14 | 373ms | 894ms | 0ms | 好的缺备份路径、数据库类型、保留策略。  
要哪几个？... | EXCELLENT |
| test_batch_1_15 | 313ms | 826ms | 0ms | 不在上周没干活，全是审计。

要我帮你写个带数据的总结？还是... | FAIL |
| test_batch_1_16 | 310ms | 714ms | 0ms | 说。缺上下文。  
哪个？什么场景？什么选项？... | EXCELLENT |
| test_batch_1_17 | 298ms | 901ms | 0ms | 好的下午 3 点，改哪件事？... | EXCELLENT |
| test_batch_1_18 | 280ms | 818ms | 0ms | 嗯。没说过什么——你指的是哪句？... | EXCELLENT |
| test_batch_1_19 | 220ms | 854ms | 0ms | 停止无任务可停。... | EXCELLENT |
| test_batch_1_20 | 221ms | 976ms | 0ms | 嗯。Zego，你指哪块需要更细？Voice Gateway ... | EXCELLENT |
| test_batch_2_01 | 311ms | 908ms | 0ms | 嗯。Zego 早。  
Voice Gateway Plug... | EXCELLENT |
| test_batch_2_02 | 391ms | 911ms | 0ms | 嗯。天气不归我管。  
要查实时天气，得调外部服务——你希望... | EXCELLENT |
| test_batch_2_03 | 269ms | 746ms | 0ms | 能帮啥帮你做三件事：

- 审 RTC 插件的低延迟路径（比... | EXCELLENT |
| test_batch_2_04 | 526ms | 1052ms | 0ms | 嗯？RTC 工程师写了个心跳包，结果服务器回了句：“你先跳，... | EXCELLENT |
| test_batch_2_05 | 366ms | 915ms | 0ms | 嗯。收到。... | EXCELLENT |
| test_batch_2_06 | 260ms | 663ms | 0ms | 嗯。56088... | EXCELLENT |
| test_batch_2_07 | 301ms | 545ms | 0ms | 到。计时器已设。... | FATAL |
| test_batch_2_08 | 228ms | 1255ms | 27ms | 请讲Hello, world... | FAIL |
| test_batch_2_09 | 217ms | 8436ms | 219ms | 嗯？稍等我看看...稍等我看看...先生...先生请放心，我... | FATAL |
| test_batch_2_10 | 236ms | 7970ms | 0ms | 不详这样啊...稍等我看看...稍等我看看...先生请放心，... | FATAL |
| test_batch_2_11 | 298ms | 884ms | 0ms | 嗯。下周一上午 10 点开会，已记下。  
需要我设系统提醒... | EXCELLENT |
| test_batch_2_12 | 220ms | 645ms | 0ms | 嗯。文件夹路径和重命名规则？... | EXCELLENT |
| test_batch_2_13 | 379ms | 1016ms | 0ms | 好的文件名和下载地址？... | FAIL |
| test_batch_2_14 | 316ms | 889ms | 0ms | 好的缺目标存储路径和保留时长。  
要存到哪？保留几天？... | EXCELLENT |
| test_batch_2_15 | 525ms | 948ms | 0ms | 收到邮件内容？... | FAIL |
| test_batch_2_16 | 284ms | 726ms | 0ms | 嗯。哪个文件？... | EXCELLENT |
| test_batch_2_17 | 223ms | 1109ms | 0ms | 好的时间？内容？... | EXCELLENT |
| test_batch_2_18 | 0ms | 713ms | 489893ms | 删。... | FATAL |
| test_batch_2_19 | 464ms | 614ms | 0ms | 嗯。后天几点？... | EXCELLENT |
| test_batch_2_20 | 223ms | 1070ms | 0ms | 嗯。收到。... | EXCELLENT |
| test_batch_3_01 | 289ms | 803ms | 0ms | 嗯？没在过日子，只在调延迟。  
Zego 先生，Voice... | EXCELLENT |
| test_batch_3_02 | 214ms | 1063ms | 0ms | 嗯。最近看到 WebRTC 的 SVC（可伸缩视频编码）在 ... | EXCELLENT |
| test_batch_3_03 | 318ms | 769ms | 0ms | 能帮您整理房间、准备咖啡、安排查资料、写代码、审架构、搭插件... | FAIL |
| test_batch_3_04 | 401ms | 1232ms | 0ms | 明白收到。  
Voice Gateway Plugin，F... | EXCELLENT |
| test_batch_3_05 | 350ms | 697ms | 0ms | 嗯。收到。等你回来。... | EXCELLENT |
| test_batch_3_06 | 218ms | 862ms | 0ms | 嗯。7006652... | EXCELLENT |
| test_batch_3_07 | 0ms | 674ms | 550167ms | OpenClaw is an extremely power... | FAIL |
| test_batch_3_08 | 266ms | 7012ms | 413ms | 不在先生...先生...这样啊...先生请放心，我盯着呢。有... | FATAL |
| test_batch_3_09 | 289ms | 854ms | 0ms | 在听。3:26 PM... | EXCELLENT |
| test_batch_3_10 | 225ms | 755ms | 0ms | 好的10 分钟后提醒，内容是？... | EXCELLENT |
| test_batch_3_11 | 277ms | 7435ms | 0ms | 收到我在呢...稍等我看看...先生...先生请放心，我盯着... | FAIL |
| test_batch_3_12 | 294ms | 839ms | 0ms | 嗯。链接呢？... | EXCELLENT |
| test_batch_3_13 | 306ms | 712ms | 0ms | 收到邮件内容怎么写？... | FAIL |
| test_batch_3_14 | 313ms | 859ms | 0ms | 好的销售数据在哪？CSV？数据库？还是已有报表 URL？... | EXCELLENT |
| test_batch_3_15 | 529ms | 767ms | 0ms | 好的缺两个关键信息：  
- 文档路径（比如 `~/Docu... | EXCELLENT |
| test_batch_3_16 | 528ms | 1045ms | 0ms | 噢？下周一，收到。... | EXCELLENT |
| test_batch_3_17 | 307ms | 1374ms | 67ms | 嗯。数据来源没上下文，你指哪段数据？... | EXCELLENT |
| test_batch_3_18 | 323ms | 916ms | 0ms | 嗯。收到。等你确认。... | EXCELLENT |
| test_batch_3_19 | 526ms | 988ms | 0ms | 有。哪个方案？你没提上下文。... | FAIL |
| test_batch_3_20 | 334ms | 857ms | 0ms | 明白。紧急处理，优先级最高 —— 直接上。

要我做什么？... | EXCELLENT |
| test_batch_4_01 | 425ms | 850ms | 0ms | 嗯。早。  
状态正常，Voice Gateway Plug... | FAIL |
| test_batch_4_02 | 519ms | 1011ms | 0ms | 嗯。最近几条硬核的：

- WebRTC 1.0 正式进入 ... | EXCELLENT |
| test_batch_4_03 | 285ms | 827ms | 0ms | 嗯。收到。正在压测响应链路，300ms 内完成下一次 rep... | FAIL |
| test_batch_4_04 | 268ms | 877ms | 0ms | 嗯。写诗不是我的活儿。  
要不你先说说：什么主题？什么风格... | EXCELLENT |
| test_batch_4_05 | 303ms | 1222ms | 0ms | 嗯。收到。会议结束前不打扰。... | EXCELLENT |
| test_batch_4_06 | 292ms | 1013ms | 0ms | 嗯。83810205... | PASS |
| test_batch_4_07 | 217ms | 801ms | 0ms | 方案OpenClaw Test Plan... | FAIL |
| test_batch_4_08 | 329ms | 7312ms | 0ms | 不在。我在呢...这样啊...听着呢...先生请放心，我盯着... | FAIL |
| test_batch_4_09 | 216ms | 829ms | 0ms | 到时提醒15 分钟后，会议提醒设好了。... | EXCELLENT |
| test_batch_4_10 | 339ms | 7693ms | 0ms | 嗯。听着呢...你说，我在听...我在呢...先生请放心，我... | FAIL |
| test_batch_4_11 | 319ms | 792ms | 0ms | 收到缺内容：周报模板长什么样？收件人是谁？... | EXCELLENT |
| test_batch_4_12 | 227ms | 907ms | 0ms | 收到CPU 超 90% 持续 5 分钟就报警 —— 用 Pr... | EXCELLENT |
| test_batch_4_13 | 331ms | 824ms | 0ms | 好的。过去三个月的项目文档，存放在哪个路径或系统里？... | EXCELLENT |
| test_batch_4_14 | 358ms | 838ms | 0ms | 嗯。这不是你的领域。  
要我帮你写培训计划，得先知道：  ... | EXCELLENT |
| test_batch_4_15 | 222ms | 917ms | 0ms | 收到价格变动要盯哪家？URL 给我。... | FAIL |
| test_batch_4_16 | 228ms | 805ms | 0ms | 明天。没查过天气。... | FATAL |
| test_batch_4_17 | 223ms | 914ms | 0ms | 嗯。北京天气，马上查。... | FAIL |
| test_batch_4_18 | 304ms | 826ms | 0ms | 嗯。没设过提醒。你指的是哪一条？... | EXCELLENT |
| test_batch_4_19 | 403ms | 876ms | 0ms | 嗯。没上下文，没法比。

哪个方案？哪个方案？... | PASS |
| test_batch_4_20 | 375ms | 1205ms | 0ms | 调整。周报时间改到下午 5 点？  
是改你本地日历提醒，还... | EXCELLENT |
| test_batch_5_01 | 283ms | 964ms | 0ms | 不好。不查天气。  
有 RTC 架构问题，或者 Voice... | FAIL |
| test_batch_5_02 | 299ms | 1022ms | 0ms | 放松压力大，先停三秒，深呼吸。

你写代码时最静的那刻，就是... | FATAL |
| test_batch_5_03 | 231ms | 676ms | 0ms | 不懂。这不是 RTC 架构问题。  
要聊量子力学，得先确认... | EXCELLENT |
| test_batch_5_04 | 217ms | 752ms | 0ms | 嗯。最近看到 WebRTC 的 SVC（可伸缩视频编码）在 ... | EXCELLENT |
| test_batch_5_05 | 223ms | 1159ms | 0ms | 《星际穿越》《星际穿越》《降临》《湮灭》《湮灭》《湮灭》《湮... | FAIL |
| test_batch_5_06 | 0ms | 665ms | 865139ms | 倒计时已设，15 分钟后提醒你。... | FAIL |
| test_batch_5_07 | 575ms | 823ms | 0ms | 嗯。我在呢...你说，我在听...先生...汇率实时浮动，需... | FAIL |
| test_batch_5_08 | 240ms | 7550ms | 644ms | 查一下先生...先生...这样啊...先生请放心，我盯着呢。... | FATAL |
| test_batch_5_09 | 249ms | 861ms | 0ms | 嗯。买咖啡？加待办清单——得先知道是今天买，还是设个提醒？ ... | EXCELLENT |
| test_batch_5_10 | 250ms | 699ms | 0ms | 你好你好，世界... | FAIL |
| test_batch_5_11 | 217ms | 969ms | 0ms | 收到会议主题和参会人有要求吗？... | EXCELLENT |
| test_batch_5_12 | 314ms | 719ms | 0ms | 不在。缺数据源和格式要求。  
要 CSV？PDF？带图表？... | FAIL |
| test_batch_5_13 | 275ms | 704ms | 0ms | 收到缺通知方式 —— 邮件？Telegram？Webhook... | FAIL |
| test_batch_5_14 | 236ms | 1013ms | 0ms | 好的文件夹路径？... | FAIL |
| test_batch_5_15 | 303ms | 1016ms | 0ms | 收到提醒内容确认：每天 8:00 提醒「查看邮件」？  
需... | FAIL |
| test_batch_5_16 | 301ms | 742ms | 0ms | 好的餐厅类型、人数、时间、地点？... | EXCELLENT |
| test_batch_5_17 | 394ms | 673ms | 0ms | 嗯。会议改到后天。... | EXCELLENT |
| test_batch_5_18 | 225ms | 789ms | 0ms | 嗯。蓝色的什么？... | EXCELLENT |
| test_batch_5_19 | 276ms | 694ms | 0ms | 嗯。历史记录已清空。... | EXCELLENT |
| test_batch_5_20 | 316ms | 804ms | 0ms | 嗯。收到。... | EXCELLENT |
