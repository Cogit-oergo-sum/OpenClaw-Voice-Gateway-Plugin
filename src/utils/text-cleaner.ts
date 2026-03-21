/**
 * [V3.2.0] TextCleaner: 全局防噪音与脱敏工具类
 * 收拢原散落在 FastAgentV3 和 ShadowManager 中的正则清洗逻辑
 */
export class TextCleaner {
    /**
     * 为播报或存储前进行终极脱敏
     * 剥离所有成对的 (...) 和 [...]，以及特定的技术标签
     */
    static decant(text: string): string {
        if (!text) return "";
        return text
            .replace(/##+\s/g, '')           // 移除标题前缀 ##
            .replace(/\*\*|__/g, '')         // 移除加粗 ** 或 __
            .replace(/\*|_/g, '')            // 移除斜体 * 或 _
            .replace(/`{1,3}.*?`{1,3}/g, '') // 移除代码块
            .replace(/!?\[(.*?)\]\(.*?\)/g, '$1') // 移除链接，仅保留文本 [txt](url) -> txt
            .replace(/^[*-]\s+/gm, '')       // 移除列表符号
            .replace(/^\d+\.\s+/gm, '')      // 移除数字列表
            .replace(/[\(\[].*?[\)\]]/g, '') // 移除成对的 (...) 和 [...]
            .replace(/[\(\[].*$/g, '')       // 移除残留的左括号及其后续内容
            .replace(/刚才我把那个“.*?”的事情处理好了，结果是：/g, '')
            .replace(/HEARTBEAT_OK/g, '')
            .replace(/session_start/g, '')
            .replace(/\(已.*?闭环\)/g, '')
            .replace(/\(已.*?同步.*?\)/g, '')
            .replace(/\[调用.*?\]/g, '')
            .replace(/\[\{.*?\}\]/g, '')
            .trim();
    }

    /**
     * 针对流式回复的小片段进行噪音净化
     */
    static clean(text: string): string {
        return text
            .replace(/\(已.*?闭环\)/g, '')
            .replace(/\(已.*?同步.*?\)/g, '')
            .replace(/\[调用.*?\]/g, '')
            .replace(/\[\{.*?\}\]/g, '')
            .replace(/HEARTBEAT_OK/g, '')
            .replace(/session_start/g, '')
            .trim();
    }
}
