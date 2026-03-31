
import { WatchdogService } from './watchdog';
import { CanvasManager } from './canvas-manager';
import { CanvasState } from './types';
import { EventEmitter } from 'events';

// Simple mock for CanvasManager
class MockCanvasManager extends EventEmitter {
    private canvases = new Map<string, CanvasState>();
    getCanvases() { return this.canvases; }
    setCanvas(id: string, s: any) { this.canvases.set(id, s as CanvasState); }
    async syncCanvasesFromDisk() { /* no-op */ }
}

async function verifyWatchdogFilter() {
    console.log('--- 🛡️ Starting Watchdog Filter Verification ---');
    const mockManager = new MockCanvasManager() as any;
    const watchdog = new WatchdogService(mockManager, 'test-instance', 100);

    const triggered: string[] = [];
    watchdog.on('trigger', ({ callId, status }) => {
        triggered.push(`${callId}:${status.status}:${status.importance_score || 0}`);
    });

    const testCases: { id: string, status: any, expected: boolean, desc: string }[] = [
        { id: 't1_failed_has_summary', status: { status: 'FAILED', is_delivered: false, summary: 'Error details', importance_score: 9 }, expected: true, desc: 'FAILED with summary should trigger' },
        { id: 't2_completed_has_summary', status: { status: 'COMPLETED', is_delivered: false, summary: 'Done', importance_score: 5 }, expected: true, desc: 'COMPLETED with summary should trigger' },
        { id: 't3_completed_no_summary', status: { status: 'COMPLETED', is_delivered: false, summary: '', direct_response: '', importance_score: 5 }, expected: false, desc: 'COMPLETED without summary/response should NOT trigger' },
        { id: 't4_ready_high_score', status: { status: 'READY', is_delivered: false, importance_score: 6 }, expected: true, desc: 'READY with score 6 (>=5) should trigger' },
        { id: 't5_ready_low_score', status: { status: 'READY', is_delivered: false, importance_score: 4 }, expected: false, desc: 'READY with score 4 (<5) should NOT trigger' },
        { id: 't6_pending_high_score', status: { status: 'PENDING', is_delivered: false, importance_score: 8, summary: 'Progress' }, expected: true, desc: 'PENDING with score 8 (>=8) should trigger' },
        { id: 't7_pending_med_score', status: { status: 'PENDING', is_delivered: false, importance_score: 7, summary: 'Progress' }, expected: false, desc: 'PENDING with score 7 (<8) should NOT trigger' },
        { id: 't8_delivered', status: { status: 'READY', is_delivered: true, importance_score: 10, summary: 'Already said' }, expected: false, desc: 'Already delivered should NOT trigger' },
        { id: 't9_failed_direct_resp', status: { status: 'FAILED', is_delivered: false, direct_response: 'Something went wrong' }, expected: true, desc: 'FAILED with direct_response should trigger' },
    ];

    for (const tc of testCases) {
        mockManager.setCanvas(tc.id, { 
            task_status: tc.status, 
            context: { is_busy: false, last_interaction_time: Date.now() } 
        });
        watchdog.registerNotifier(tc.id, async () => {});
    }

    watchdog.start();
    // Wait for at least 2 scan cycles
    await new Promise(r => setTimeout(r, 250));
    watchdog.stop();

    console.log('\nResults:');
    let allPassed = true;
    for (const tc of testCases) {
        const wasTriggered = triggered.some(t => t.startsWith(`${tc.id}:`));
        const passed = wasTriggered === tc.expected;
        const statusStr = passed ? '✅ PASS' : '❌ FAIL';
        console.log(`${statusStr} | ${tc.id.padEnd(25)} | Expected: ${tc.expected ? 'T' : 'F'} | Actual: ${wasTriggered ? 'T' : 'F'} | ${tc.desc}`);
        if (!passed) allPassed = false;
    }

    if (allPassed) {
        console.log('\n🎉 All test cases passed!');
        process.exit(0);
    } else {
        console.error('\n🛑 Some test cases failed!');
        process.exit(1);
    }
}

verifyWatchdogFilter().catch(err => {
    console.error(err);
    process.exit(1);
});
