import { FastAgentV3 } from './fast-agent-v3';
import { IFastAgent } from './types';
import { PluginConfig } from '../types/config';

export class FastAgentFactory {
    static create(config: PluginConfig, workspaceRoot: string): IFastAgent {
        return new FastAgentV3(config, workspaceRoot);
    }
}
