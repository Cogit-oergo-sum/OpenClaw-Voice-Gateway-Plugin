import { SkillRegistry } from '../src/agent/skills/index';
import * as fs from 'fs/promises';
import * as path from 'path';

async function testLoadFromDirectory() {
    console.log('--- 测试 loadFromDirectory 解析 runtime ---');
    const registry = SkillRegistry.getInstance();
    const tempDir = path.join(process.cwd(), 'tmp_skills_test');

    try {
        await fs.mkdir(tempDir, { recursive: true });
        const skillPath = path.join(tempDir, 'test_native');
        await fs.mkdir(skillPath, { recursive: true });

        const skillMD = `---
name: test_native_skill_from_md
description: A native skill loaded from MD
runtime: native
---
# Test Native Skill
`;
        await fs.writeFile(path.join(skillPath, 'SKILL.md'), skillMD);

        await registry.loadFromDirectory(tempDir);

        const skill = registry.getSkill('test_native_skill_from_md');
        if (skill && (skill as any).runtime === 'native') {
            console.log(`✅ 测试通过: 成功加载并在 ${skill.name} 中解析到 runtime: native`);
        } else {
            console.error('❌ 测试失败: runtime 解析错误或未加载技能', (skill as any)?.runtime);
            process.exit(1);
        }

    } finally {
        await fs.rm(tempDir, { recursive: true, force: true });
    }

    console.log('\n--- loadFromDirectory 测试完成 ---');
}

testLoadFromDirectory();
