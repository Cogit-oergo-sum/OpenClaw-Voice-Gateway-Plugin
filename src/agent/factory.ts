import { FastAgentV3 } from './fast-agent-v3';
import { IFastAgent } from './types';
import { PluginConfig } from '../types/config';
import { CallManager } from '../call/call-manager';

export class FastAgentFactory {
    static create(config: PluginConfig, workspaceRoot: string, callManager?: CallManager): IFastAgent {
        return new FastAgentV3(config, workspaceRoot, callManager);
    }
}
