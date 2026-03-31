import { SkillRegistry } from '../src/agent/skills/index';
import { DynamicSkillWrapper } from '../src/agent/skills/DynamicSkillWrapper';
import { CanvasManager } from '../src/agent/canvas-manager';

async function testNativeSkill() {
    console.log('--- 开始测试 Native Skill 路由 ---');

    const registry = SkillRegistry.getInstance();
    const mockCanvasManager = {} as CanvasManager;

    // 1. 注册 Native Handler
    const testSkillName = 'test_native_logic';
    registry.registerNativeHandler(testSkillName, async (args: any, callId: string, canvas: any) => {
        console.log(`[TestHandler] 收到参数: ${JSON.stringify(args)}`);
        return `SUCCESS: Native handler executed for ${testSkillName} with input ${args.input}`;
    });

    // 2. 模拟从 SKILL.md 加载出的 Wrapper (runtime: native)
    const wrapper = new DynamicSkillWrapper({
        name: testSkillName,
        description: 'A test native skill',
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
        runtime: 'native'
    });

    // 3. 执行并验证
    try {
        console.log('执行 Wrapper.execute...');
        const result = await wrapper.execute({ input: 'hello world' }, 'call-123', mockCanvasManager);
        console.log(`结果: ${result}`);

        if (result.includes('SUCCESS') && result.includes('hello world')) {
            console.log('✅ 测试通过: 成功进入 Native 路由分支');
        } else {
            console.error('❌ 测试失败: 结果不匹配');
            process.exit(1);
        }
    } catch (e) {
        console.error('❌ 测试执行出错:', e);
        process.exit(1);
    }

    // 4. 测试未注册 Handler 的情况
    console.log('\n--- 测试未注册 Handler 的错误处理 ---');
    const ghostWrapper = new DynamicSkillWrapper({
        name: 'ghost_skill',
        description: 'Not registered',
        runtime: 'native'
    });

    const ghostResult = await ghostWrapper.execute({}, 'call-456', mockCanvasManager);
    console.log(`结果: ${ghostResult}`);
    if (ghostResult.includes('not found')) {
        console.log('✅ 测试通过: 错误处理符合预期');
    } else {
        console.error('❌ 测试失败: 应该报错但没报错');
        process.exit(1);
    }

    console.log('\n--- 所有 Native Skill 路由测试完成 ---');
}

testNativeSkill();
