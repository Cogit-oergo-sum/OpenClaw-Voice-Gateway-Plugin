import { ModeManager } from '../src/agent/mode-manager';
import * as fs from 'fs';
import * as path from 'path';

async function verify() {
    console.log('🚀 Starting ModeManager Integration Verification...');
    const workspaceRoot = path.resolve('./demo_workspace');

    // 确保测试目录存在
    const modesDir = path.join(workspaceRoot, 'modes');
    if (!fs.existsSync(modesDir)) {
        console.error(`❌ modes directory not found: ${modesDir}`);
        process.exit(1);
    }

    // 1. 创建 ModeManager 并加载
    const manager = new ModeManager(workspaceRoot);
    await manager.loadFromDirectory();

    // 2. 检查加载的模式数量
    const modeNames = manager.getModeNames();
    console.log(`- Loaded modes: ${modeNames.join(', ')}`);
    if (modeNames.length < 2) {
        console.error(`❌ Expected at least 2 modes, got ${modeNames.length}`);
        process.exit(1);
    }

    // 3. 检查初始模式
    const initialMode = manager.getInitialMode();
    console.log(`- Initial mode: ${initialMode}`);
    if (initialMode !== 'working') {
        console.error(`❌ Expected initial mode 'working', got '${initialMode}'`);
        process.exit(1);
    }

    // 4. 检查模式提示词
    const workingPrompt = manager.getModePrompt('working');
    console.log(`- Working prompt length: ${workingPrompt.length}`);
    if (!workingPrompt.includes('职场助手')) {
        console.error(`❌ Working prompt missing expected content`);
        process.exit(1);
    }

    const gamePrompt = manager.getModePrompt('game');
    console.log(`- Game prompt length: ${gamePrompt.length}`);
    if (!gamePrompt.includes('游戏伙伴')) {
        console.error(`❌ Game prompt missing expected content`);
        process.exit(1);
    }

    // 5. 检查工具 schema
    const schema = manager.getModeSwitchSchema();
    if (!schema) {
        console.error(`❌ getModeSwitchSchema returned null`);
        process.exit(1);
    }
    console.log(`- Schema function name: ${schema.function.name}`);
    if (schema.function.name !== 'mode_switch') {
        console.error(`❌ Schema function name mismatch`);
        process.exit(1);
    }
    console.log(`- Schema enum: ${schema.function.parameters.properties.target_mode.enum.join(', ')}`);
    if (!schema.function.parameters.properties.target_mode.enum.includes('working')) {
        console.error(`❌ Schema enum missing 'working'`);
        process.exit(1);
    }

    // 6. 检查模式描述
    const descriptions = manager.getModeDescriptions();
    console.log(`- Mode descriptions:\n${descriptions}`);
    if (!descriptions.includes('working:') || !descriptions.includes('game:')) {
        console.error(`❌ Mode descriptions missing expected modes`);
        process.exit(1);
    }

    // 7. 检查 handleModeSwitch
    const result = manager.handleModeSwitch({ target_mode: 'game', context: { interests: ['射击'] } });
    console.log(`- handleModeSwitch result: ${JSON.stringify(result)}`);
    if (result.new_mode !== 'game') {
        console.error(`❌ handleModeSwitch returned wrong mode`);
        process.exit(1);
    }

    console.log('\n✅ ALL TESTS PASSED!');
    process.exit(0);
}

verify().catch(e => {
    console.error('\n❌ VERIFICATION FAILED:');
    console.error(e);
    process.exit(1);
});