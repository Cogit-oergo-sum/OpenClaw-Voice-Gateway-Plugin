import { FastAgent } from './fast-agent';
import { FastAgentV3 } from './fast-agent-v3';
import { IFastAgent } from './types';
import { PluginConfig } from '../types/config';

export class FastAgentFactory {
    static create(config: PluginConfig, workspaceRoot: string): IFastAgent {
        const version = config.fastAgent?.version || 'v2';
        console.log(`[FastAgentFactory] Creating FastAgent version: ${version}`);

        switch (version.toLowerCase()) {
            case 'v3':
                return new FastAgentV3(config, workspaceRoot);
            case 'v2':
            default:
                return new FastAgent(config, workspaceRoot);
        }
    }
}
