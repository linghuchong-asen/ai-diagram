// 语图技术方案 - 追问建议断言脚本（competitor-driven-evolution-batch Round 8）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/followup-suggest.check.ts
// 覆盖：五形态各 3 条、跨形态建议带 formHint、标签/提示词非空、确定性、返回拷贝防篡改。
import { suggestFollowups } from '../artifacts/followup-suggest';
import type { ArtifactKind } from '../../../utils/aiClient';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

describe('追问建议（Round 8）', () => {
  const kinds: ArtifactKind[] = ['flowchart', 'mindmap', 'table', 'checklist', 'timeline'];

  it('五形态各返回 3 条建议,标签与提示词非空', () => {
    for (const kind of kinds) {
      const list = suggestFollowups(kind);
      assertEqual(list.length, 3, `${kind} 应有 3 条建议`);
      for (const item of list) {
        assertTrue(item.label.trim().length > 0, `${kind} 标签非空`);
        assertTrue(item.prompt.trim().length >= 6, `${kind} 提示词应有可执行内容`);
      }
    }
  });

  it('每形态恰有 1 条跨形态建议,携带 formHint 且指向不同形态', () => {
    for (const kind of kinds) {
      const cross = suggestFollowups(kind).filter((s) => s.formHint);
      assertEqual(cross.length, 1, `${kind} 应恰有 1 条跨形态建议`);
      assertTrue(cross[0]!.formHint !== kind, `${kind} 跨形态建议应指向其他形态`);
      assertTrue(cross[0]!.formHint !== 'flowchart' || kind !== 'flowchart', '非 flowchart 的跨建议可回流程图');
    }
  });

  it('确定性:同输入同输出;返回拷贝(改返回值不影响内部库)', () => {
    assertEqual(JSON.stringify(suggestFollowups('table')), JSON.stringify(suggestFollowups('table')), '确定性');
    const first = suggestFollowups('table');
    first[0]!.label = '被篡改';
    assertNotEqualImpl(suggestFollowups('table')[0]!.label, '被篡改', '返回值应为拷贝');
  });

  it('未知形态兜底到 flowchart 建议库(防御)', () => {
    // @ts-expect-error 故意传入非法形态验证防御
    const fallback = suggestFollowups('unknown-kind');
    assertEqual(fallback.length, 3, '兜底仍返回 3 条');
  });
});

function assertNotEqualImpl(actual: unknown, unexpected: unknown, message: string): void {
  if (actual === unexpected) throw new Error(`${message}(不应等于 ${String(unexpected)})`);
}

finish('追问建议（followup-suggest.check · Round 8）');
