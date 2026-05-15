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
            .replace(/<shadow>/g, '')
            .replace(/<\/shadow>/g, '')
            .replace(/##+\s/g, '')           // 移除标题前缀 ##
            .replace(/\*\*/g, '')            // 移除加粗 **
            .replace(/\*/g, '')              // 移除标记 *
            .replace(/`{1,3}.*?`{1,3}/g, '') // 移除代码块
            .replace(/!?\[(.*?)\]\(.*?\)/g, '$1') // 移除链接，仅保留文本 [txt](url) -> txt
            .replace(/^[*-]\s+/gm, '')       // 移除列表符号
            .replace(/^\d+\.\s+/gm, '')      // 移除数字列表
            .replace(/[\(\（].*?[\)\）]/g, '')       // 移除成对的 (...) 和 （...）
            .replace(/\[.*?\]/g, '')               // 移除成对的 [...]
            .replace(/\{.*?\}/g, '')               // 移除成对的 {...} (JSON)
            .replace(/[\(\（\[\{].*$/g, '')          // 移除残留的左括号及其后续内容
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
            .replace(/<shadow>/g, '')
            .replace(/<\/shadow>/g, '')
            .replace(/\(已.*?闭环\)/g, '')
            .replace(/\(已.*?同步.*?\)/g, '')
            .replace(/\[调用.*?\]/g, '')
            .replace(/\[\{.*?\}\]/g, '')
            .replace(/HEARTBEAT_OK/g, '')
            .replace(/session_start/g, '')
            .trim();
    }

    /**
     * [V4.5] ACTION 协议后处理
     * - 剥离当前模式白名单外的 ACTION
     * - 去除连续重复 ACTION
     * - 限制单轮最多 1 个 ACTION
     */
    static filterActions(text: string, currentMode: string, previousActions: string[] = []): string {
        // 各模式允许的 ACTION 白名单
        const MODE_ACTION_WHITELIST: Record<string, string[]> = {
            zego_intro: ['SHOW_PAGE', 'JUMP_TO_URL'],
            discovery: ['SHOW_PAGE', 'JUMP_TO_URL'],
            solution: ['SHOW_PAGE', 'JUMP_TO_URL', 'SHOW_DOC_URL'],
            integration_guide: ['SHOW_PAGE', 'SHOW_DOC_URL', 'JUMP_TO_URL', 'POPUP_LEAD_FORM'],
            conversion: ['SHOW_PAGE', 'SHOW_DOC_URL', 'POPUP_LEAD_FORM', 'JUMP_TO_URL'],
            end_session: [],  // end_session 阶段禁止所有 ACTION
        };

        const whitelist = MODE_ACTION_WHITELIST[currentMode] || [];
        const actionRegex = /\[ACTION:([^\]]+)\]/g;
        const actions: { full: string; name: string }[] = [];
        let match;

        while ((match = actionRegex.exec(text)) !== null) {
            actions.push({ full: match[0], name: match[1].split(':')[0].split(',')[0] });
        }

        if (actions.length === 0) return text;

        let result = text;

        // 1. 剥离白名单外的 ACTION
        for (const action of actions) {
            if (!whitelist.includes(action.name)) {
                result = result.replace(action.full, '');
            }
        }

        // 2. 去除与上一轮重复的 ACTION
        const remainingActions: { full: string; name: string }[] = [];
        const newActionRegex = /\[ACTION:([^\]]+)\]/g;
        while ((match = newActionRegex.exec(result)) !== null) {
            remainingActions.push({ full: match[0], name: match[1] });
        }

        for (const action of remainingActions) {
            if (previousActions.includes(action.name)) {
                result = result.replace(action.full, '');
            }
        }

        // 3. 限制单轮最多 1 个 ACTION（保留第一个，删除其余）
        const finalActions: { full: string; name: string }[] = [];
        const finalRegex = /\[ACTION:([^\]]+)\]/g;
        while ((match = finalRegex.exec(result)) !== null) {
            finalActions.push({ full: match[0], name: match[1] });
        }

        if (finalActions.length > 1) {
            // 保留第一个，删除其余
            for (let i = 1; i < finalActions.length; i++) {
                result = result.replace(finalActions[i].full, '');
            }
        }

        return result.replace(/\s{2,}/g, ' ').trim();
    }
}
