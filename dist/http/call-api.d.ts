import { CallManager } from '../call/call-manager';
import type { ZegoConfig } from '../types/config';
export declare function startCallHandler(manager: CallManager, config: ZegoConfig): (req: any, res: any) => Promise<any>;
export declare function endCallHandler(manager: CallManager): (req: any, res: any) => Promise<any>;
export declare function statusHandler(manager: CallManager): (req: any, res: any) => Promise<any>;
export declare function refreshTokenHandler(manager: CallManager, config: ZegoConfig): (req: any, res: any) => Promise<any>;
