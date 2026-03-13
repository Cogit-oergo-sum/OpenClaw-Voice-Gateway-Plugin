import { AsyncLocalStorage } from 'async_hooks';

export interface CallContext {
    callId: string;
    userId: string;
    startTime: number;
    metadata: Record<string, any>;
}

export const callContextStorage = new AsyncLocalStorage<CallContext>();

/**
 * 获取当前协程/上下文绑定的 CallID
 */
export function getCurrentCallId(): string | undefined {
    return callContextStorage.getStore()?.callId;
}

/**
 * 获取当前完整的上下文
 */
export function getContext(): CallContext | undefined {
    return callContextStorage.getStore();
}
