/**
 * [V4.4] Skill 启停三层控制验证脚本
 * 测试：1. SKILL.md enabled:false  2. DISABLED_SKILLS 环境变量  3. disableSkill() API
 * 以及 user-invocable:false 对 Router 的影响
 */
import * as path from 'path';
import * as fs from 'fs/promises';

// 直接复用编译后的模块
const SKILLS_REPO = path.join(__dirname, '..', 'skills_repo');

interface TestResult {
    name: string;
    passed: boolean;
    detail: string;
}

const results: TestResult[] = [];

function assert(name: string, condition: boolean, detail: string) {
    results.push({ name, passed: condition, detail });
    const icon = condition ? '✅' : '❌';
    console.log(`${icon} ${name}: ${detail}`);
}

async function main() {
    console.log('🚀 Skill 启停三层控制验证\n');

    // 动态导入编译后的模块
    const { SkillRegistry } = await import('../src/agent/skills/index');
    const { DynamicSkillWrapper } = await import('../src/agent/skills/DynamicSkillWrapper');
    const yaml = await import('js-yaml');

    // ============================================================
    // 测试 1: SKILL.md enabled:false
    // ============================================================
    console.log('\n--- 测试 1: SKILL.md enabled:false ---');

    // 重置单例
    (SkillRegistry as any).instance = null;
    const registry1 = SkillRegistry.getInstance();

    // 手动模拟 loadFromDirectory 的核心逻辑（读取 delegate_task/SKILL.md）
    const skillFile = path.join(SKILLS_REPO, 'delegate_task', 'SKILL.md');
    const content = await fs.readFile(skillFile, 'utf8');
    const fmMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*\n/);
    const config: any = yaml.load(fmMatch![1]);

    assert(
        'SKILL.md 解析 enabled:false',
        config.enabled === false,
        `config.enabled = ${config.enabled}`
    );

    // 注册后禁用
    const skill1 = new DynamicSkillWrapper({
        name: config.name,
        description: config.description,
        parameters: config.parameters,
        isLongRunning: config.isLongRunning,
        runtime: config.runtime || 'mcp',
    });
    registry1.register(skill1);
    if (config.enabled === false) {
        registry1.disableSkill(skill1.name);
    }

    assert(
        'enabled:false → getSkill 返回 undefined',
        registry1.getSkill('delegate_task') === undefined,
        `getSkill('delegate_task') = ${registry1.getSkill('delegate_task')}`
    );

    assert(
        'enabled:false → hasSkill 返回 false',
        registry1.hasSkill('delegate_task') === false,
        `hasSkill('delegate_task') = ${registry1.hasSkill('delegate_task')}`
    );

    assert(
        'enabled:false → 不出现在 Router 摘要',
        !registry1.getRouterSkillSummary().includes('delegate_task'),
        `Router 摘要包含 delegate_task: ${registry1.getRouterSkillSummary().includes('delegate_task')}`
    );

    // ============================================================
    // 测试 2: DISABLED_SKILLS 环境变量
    // ============================================================
    console.log('\n--- 测试 2: DISABLED_SKILLS 环境变量 ---');

    (SkillRegistry as any).instance = null;
    const registry2 = SkillRegistry.getInstance();

    // 注册一个正常 skill
    const skill2 = new DynamicSkillWrapper({
        name: 'test_weather',
        description: '测试天气技能',
        parameters: { type: 'object', properties: {} },
        isLongRunning: true,
        runtime: 'mcp',
        endpoint: 'http://localhost:3003/weather',
    });
    registry2.register(skill2);

    assert(
        '正常注册 → getSkill 可获取',
        registry2.getSkill('test_weather') !== undefined,
        `getSkill('test_weather') = ${registry2.getSkill('test_weather')?.name}`
    );

    // 通过环境变量禁用
    process.env.DISABLED_SKILLS = 'test_weather';
    // 模拟 loadFromDirectory 末尾的环境变量逻辑
    const disabledEnv = process.env.DISABLED_SKILLS;
    if (disabledEnv) {
        const names = disabledEnv.split(',').map(s => s.trim()).filter(Boolean);
        for (const name of names) {
            registry2.disableSkill(name);
        }
    }

    assert(
        'DISABLED_SKILLS → getSkill 返回 undefined',
        registry2.getSkill('test_weather') === undefined,
        `getSkill('test_weather') = ${registry2.getSkill('test_weather')}`
    );

    assert(
        'DISABLED_SKILLS → 不出现在 Router 摘要',
        !registry2.getRouterSkillSummary().includes('test_weather'),
        `Router 摘要包含 test_weather: ${registry2.getRouterSkillSummary().includes('test_weather')}`
    );

    delete process.env.DISABLED_SKILLS;

    // ============================================================
    // 测试 3: disableSkill() / enableSkill() API
    // ============================================================
    console.log('\n--- 测试 3: disableSkill() / enableSkill() API ---');

    (SkillRegistry as any).instance = null;
    const registry3 = SkillRegistry.getInstance();

    const skill3 = new DynamicSkillWrapper({
        name: 'test_api_skill',
        description: 'API 测试技能',
        parameters: { type: 'object', properties: {} },
        runtime: 'mcp',
        endpoint: 'http://localhost:9999/test',
    });
    registry3.register(skill3);

    assert(
        '注册后 → 可获取',
        registry3.getSkill('test_api_skill') !== undefined,
        `getSkill = ${registry3.getSkill('test_api_skill')?.name}`
    );

    registry3.disableSkill('test_api_skill');

    assert(
        'disableSkill() → getSkill 返回 undefined',
        registry3.getSkill('test_api_skill') === undefined,
        `getSkill = ${registry3.getSkill('test_api_skill')}`
    );

    assert(
        'disableSkill() → hasSkill 返回 false',
        registry3.hasSkill('test_api_skill') === false,
        `hasSkill = ${registry3.hasSkill('test_api_skill')}`
    );

    registry3.enableSkill('test_api_skill');

    assert(
        'enableSkill() → getSkill 恢复可获取',
        registry3.getSkill('test_api_skill') !== undefined,
        `getSkill = ${registry3.getSkill('test_api_skill')?.name}`
    );

    assert(
        'enableSkill() → hasSkill 恢复 true',
        registry3.hasSkill('test_api_skill') === true,
        `hasSkill = ${registry3.hasSkill('test_api_skill')}`
    );

    // ============================================================
    // 测试 4: user-invocable:false
    // ============================================================
    console.log('\n--- 测试 4: user-invocable:false ---');

    (SkillRegistry as any).instance = null;
    const registry4 = SkillRegistry.getInstance();

    const skillVisible = new DynamicSkillWrapper({
        name: 'visible_skill',
        description: '用户可调用技能',
        parameters: { type: 'object', properties: {} },
        runtime: 'mcp',
        endpoint: 'http://localhost:9999/test',
    });
    registry4.register(skillVisible);

    const skillHidden = new DynamicSkillWrapper({
        name: 'hidden_skill',
        description: '内部路由技能',
        parameters: { type: 'object', properties: {} },
        runtime: 'mcp',
        endpoint: 'http://localhost:9999/test',
    });
    (skillHidden as any).userInvocable = false;
    registry4.register(skillHidden);

    const routerSummary = registry4.getRouterSkillSummary();

    assert(
        'user-invocable:true → 出现在 Router 摘要',
        routerSummary.includes('visible_skill'),
        `Router 摘要包含 visible_skill`
    );

    assert(
        'user-invocable:false → 不出现在 Router 摘要',
        !routerSummary.includes('hidden_skill'),
        `Router 摘要包含 hidden_skill: ${routerSummary.includes('hidden_skill')}`
    );

    assert(
        'user-invocable:false → getSkill 仍可获取',
        registry4.getSkill('hidden_skill') !== undefined,
        `SLE 仍可调用 hidden_skill`
    );

    // ============================================================
    // 汇总
    // ============================================================
    console.log('\n--- 汇总 ---');
    const passed = results.filter(r => r.passed).length;
    const total = results.length;
    console.log(`${passed}/${total} 通过`);

    if (passed !== total) {
        console.log('\n❌ 失败项:');
        results.filter(r => !r.passed).forEach(r => console.log(`  - ${r.name}: ${r.detail}`));
        process.exit(1);
    }

    console.log('\n✅ 全部通过');
    process.exit(0);
}

main().catch(e => {
    console.error('❌ 验证脚本异常:', e);
    process.exit(1);
});
