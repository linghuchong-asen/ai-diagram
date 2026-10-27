// 语图 Round E（思维体质图 archetype 映射）可执行断言脚本
// 覆盖：计点制映射、平票确定性、未答题跳过、全未答兜底、四原型可达性、prompt 完整性。
// 运行：cd frontend && npx tsx src/pages/mind/__checks__/archetype.check.ts

import {
  ARCHETYPES,
  MIND_QUESTIONS,
  answeredCount,
  computeArchetype,
} from '../archetype';
import {
  assertEqual,
  assertTrue,
  describe,
  finish,
  it,
} from '../../ai/__checks__/check-util';

describe('computeArchetype：计点制映射', () => {
  it('单一倾向全选 → 对应原型（四种各验一次，可达性）', () => {
    // 每题都选第 0 个选项 → 全部倾向 decision
    assertEqual(computeArchetype([0, 0, 0, 0, 0]).key, 'decision', '全选首项应为 decision');
    assertEqual(computeArchetype([1, 1, 1, 1, 1]).key, 'radial', '全选次项应为 radial');
    assertEqual(computeArchetype([2, 2, 2, 2, 2]).key, 'lane', '全选第三项应为 lane');
    assertEqual(computeArchetype([3, 3, 3, 3, 3]).key, 'loop', '全选第四项应为 loop');
  });

  it('多数倾向胜出（3:2 分布）', () => {
    // Q1/Q2 选 loop（第 4 项），Q3/Q4/Q5 选 decision（第 1 项）
    const result = computeArchetype([3, 3, 0, 0, 0]);
    assertEqual(result.key, 'decision', '3 票 decision 应胜 2 票 loop');
  });

  it('平票时按固定顺序取先者（确定性，同答案必同结果）', () => {
    // decision 与 radial 各 2 票、loop 1 票：decision 顺序在前应胜出
    const result = computeArchetype([0, 0, 1, 1, 3]);
    assertEqual(result.key, 'decision', '平票应取顺序在前的 decision');
  });

  it('未答（-1）跳过不计票', () => {
    // 仅答两题且均倾向 radial
    const result = computeArchetype([1, 1, -1, -1, -1]);
    assertEqual(result.key, 'radial', '未答题不应参与计票');
  });

  it('全部未答 → decision 兜底（页面会校验，此处纯函数防御）', () => {
    assertEqual(computeArchetype([-1, -1, -1, -1, -1]).key, 'decision', '全未答兜底 decision');
  });

  it('非法下标（越界/非数字）按未答处理，不抛错', () => {
    const result = computeArchetype([99, undefined as unknown as number, 1, 1, 1]);
    assertEqual(result.key, 'radial', '越界与非数字应跳过，剩余 3 票 radial 生效');
  });
});

describe('数据契约完整性', () => {
  it('题目与选项：5 题 × 4 项，四种倾向在每题中各出现一次（均衡设计）', () => {
    assertEqual(MIND_QUESTIONS.length, 5, '应为 5 道题');
    for (const question of MIND_QUESTIONS) {
      assertEqual(question.options.length, 4, `Q${question.id} 应有 4 个选项`);
      const tendencies = new Set(question.options.map((option) => option.tendency));
      assertEqual(tendencies.size, 4, `Q${question.id} 四个选项应覆盖四种倾向`);
    }
  });

  it('四种原型档案齐全：名称/标语/描述/生成 prompt 均非空且 prompt 为完整指令句', () => {
    for (const key of ['decision', 'radial', 'lane', 'loop'] as const) {
      const profile = ARCHETYPES[key];
      assertEqual(profile.key, key, 'key 自洽');
      assertTrue(profile.name.length > 0, `${key} name 非空`);
      assertTrue(profile.tagline.length > 0, `${key} tagline 非空`);
      assertTrue(profile.description.length >= 20, `${key} description 应为完整段落`);
      assertTrue(profile.prompt.length >= 40, `${key} prompt 应为可直接生成的完整指令`);
    }
  });

  it('answeredCount：-1 不计入', () => {
    assertEqual(answeredCount([0, -1, 2, -1, 3]), 3, '-1 应不计入已答数');
    assertEqual(answeredCount([-1, -1, -1, -1, -1]), 0, '全 -1 为 0');
  });
});

finish('archetype');
