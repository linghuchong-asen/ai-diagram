// 语图技术方案 - 会话内版本历史栈断言脚本（competitor-driven-evolution-batch Round 11）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/history-stack.check.ts
// 覆盖：push/cursor 复位、上限裁剪、步进夹紧与相等性短路、标签生成、不可变性。
import { createHistory, pushHistory, stepHistory, historyCurrent, historyLabelFor, HISTORY_LIMIT } from '../session/history-stack';
import type { AiResult } from '../../../utils/aiClient';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

function genResult(mark: string): AiResult {
  return {
    kind: 'generate',
    artifactKind: 'table',
    tableDraft: { columns: ['维度', mark], rows: [['a', 'b'], ['c', 'd']] },
  } as AiResult;
}

/** 取版本内容的标记列(联合类型需先收窄 kind) */
function markOf(entry: { payload: AiResult } | undefined): string {
  if (entry && entry.payload.kind === 'generate' && entry.payload.tableDraft) {
    return entry.payload.tableDraft.columns[1] ?? '';
  }
  return '';
}

describe('版本历史栈（Round 11）', () => {
  it('push 后 cursor 指向最新;current 取当前版本', () => {
    let state = createHistory();
    assertEqual(state.cursor, -1, '初始无版本');
    state = pushHistory(state, genResult('v1'), '第 1 版', 1000, 'id1');
    assertEqual(state.cursor, 0, 'push 后指向最新');
    state = pushHistory(state, genResult('v2'), '第 2 版', 2000, 'id2');
    assertEqual(state.cursor, 1, '仍指向最新');
    assertEqual(markOf(historyCurrent(state)), 'v2', '当前版本内容');
  });

  it('步进:回退/前进;越界夹紧;无变化返回原引用(短路)', () => {
    let state = createHistory();
    for (let i = 1; i <= 3; i += 1) state = pushHistory(state, genResult(`v${i}`), `第 ${i} 版`, i * 1000, `id${i}`);
    assertEqual(state.cursor, 2, '最新');
    const back = stepHistory(state, -1);
    assertEqual(back.cursor, 1, '回退一版');
    assertEqual(stepHistory(back, -1).cursor, 0, '再回退');
    const clampedLow = stepHistory(stepHistory(back, -1), -1);
    assertEqual(clampedLow.cursor, 0, '下界夹紧');
    assertEqual(clampedLow === stepHistory(clampedLow, -1), true, '越界步进返回原引用');
    const forward = stepHistory(clampedLow, 2);
    assertEqual(forward.cursor, 2, '前进(超步会直接到界内目标)');
    assertEqual(stepHistory(forward, 1) === forward, true, '上界夹紧返回原引用');
    assertEqual(markOf(historyCurrent(forward)), 'v3', '前进后取到 v3');
  });

  it('上限裁剪:超过 20 版丢最旧,游标仍指向最新', () => {
    let state = createHistory();
    for (let i = 1; i <= HISTORY_LIMIT + 5; i += 1) {
      state = pushHistory(state, genResult(`v${i}`), `第 ${i} 版`, i, `id${i}`);
    }
    assertEqual(state.entries.length, HISTORY_LIMIT, '裁剪到上限');
    assertEqual(state.cursor, HISTORY_LIMIT - 1, 'cursor=最新');
    assertEqual(state.entries[0]?.id, 'id6', '最旧被丢弃(从 id6 开始)');
  });

  it('标签:形态中文名 + 版本号;modify/consult 亦有兜底', () => {
    assertEqual(historyLabelFor(genResult('x'), 3), '对比表格 · 第 3 版', 'table 标签');
    assertEqual(historyLabelFor({ kind: 'generate' } as AiResult, 1), '流程图 · 第 1 版', '缺省形态=流程图');
    assertTrue(historyLabelFor({ kind: 'consult', answer: 'a' } as AiResult, 2).includes('consult'), '非 generate 兜底');
  });

  it('不可变:push/step 均不改原状态', () => {
    let state = createHistory();
    state = pushHistory(state, genResult('v1'), 'l', 1, 'id1');
    const snapshot = JSON.stringify(state);
    pushHistory(state, genResult('v2'), 'l', 2, 'id2');
    stepHistory(state, -1);
    assertEqual(JSON.stringify(state), snapshot, '原状态不变');
  });
});

finish('版本历史栈（history-stack.check · Round 11）');
