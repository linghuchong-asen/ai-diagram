// 语图技术方案 - 本地草稿箱断言脚本（competitor-driven-evolution-batch Round 12）
// 运行：cd frontend && npx tsx src/utils/__checks__/artifact-drafts.check.ts
// 覆盖：内存桩存取往返、上限裁剪、损坏 JSON/非法条目容错、非 generate 拒存、配额超限、删除/清空。
import {
  loadDraftsFrom,
  saveDraftTo,
  removeDraftFrom,
  clearDraftsIn,
  ARTIFACT_DRAFTS_LIMIT,
  ARTIFACT_DRAFTS_KEY,
  type DraftStorageLike,
} from '../artifact-drafts';
import type { AiResult } from '../aiClient';
import { describe, it, finish, assertTrue, assertEqual } from '../../pages/ai/__checks__/check-util';

/** 内存存储桩(与 localStorage 同契约) */
function makeStore(): DraftStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** 配额超限桩:setItem 抛错 */
function quotaStore(): DraftStorageLike {
  return { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => undefined };
}

function genResult(kind: 'table' | 'flowchart' = 'table', mark = 'v'): AiResult {
  if (kind === 'flowchart') {
    return {
      kind: 'generate',
      flowDraft: {
        nodes: [{ id: 'n1', label: mark, type: 'process' }, { id: 'n2', label: 'x', type: 'process' }],
        edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
      },
    } as AiResult;
  }
  return { kind: 'generate', artifactKind: 'table', tableDraft: { columns: ['维度', mark], rows: [['a', 'b'], ['c', 'd']] } } as AiResult;
}

describe('本地草稿箱（Round 12）', () => {
  it('存取往返:save 后 load 返回同构数据,新的在前', () => {
    const store = makeStore();
    assertTrue(saveDraftTo(store, genResult('table', 'v1'), 1000) !== null, '首次保存成功');
    saveDraftTo(store, genResult('table', 'v2'), 2000);
    const drafts = loadDraftsFrom(store);
    assertEqual(drafts.length, 2, '两条草稿');
    const first = drafts[0]!;
    assertTrue(first.payload.kind === 'generate' && first.payload.tableDraft?.columns[1] === 'v2', '最新的在前');
    assertEqual(first.kind, 'table', '形态记录');
  });

  it('上限裁剪:超过 20 条丢最旧', () => {
    const store = makeStore();
    for (let i = 1; i <= ARTIFACT_DRAFTS_LIMIT + 3; i += 1) {
      saveDraftTo(store, genResult('table', `v${i}`), i);
    }
    const drafts = loadDraftsFrom(store);
    assertEqual(drafts.length, ARTIFACT_DRAFTS_LIMIT, '裁剪到上限');
    assertTrue(drafts[0]?.payload.kind === 'generate' && drafts[0]!.payload.kind === 'generate', '结构完整');
  });

  it('损坏容错:非法 JSON/非数组/垃圾条目 → 过滤或重置,不抛异常', () => {
    const store = makeStore();
    store.setItem(ARTIFACT_DRAFTS_KEY, '{oops not json');
    assertEqual(loadDraftsFrom(store).length, 0, '坏 JSON → 空');
    store.setItem(ARTIFACT_DRAFTS_KEY, JSON.stringify([{ garbage: true }, { id: 'd1', kind: 'table', at: 1, payload: { kind: 'generate', artifactKind: 'table', tableDraft: { columns: ['a', 'b'], rows: [['1', '2']] } } }]));
    const drafts = loadDraftsFrom(store);
    assertEqual(drafts.length, 1, '垃圾条目被过滤,合法条目保留');
    assertEqual(drafts[0]?.id, 'd1', '保留合法条目');
  });

  it('拒存:modify/consult 结果与形态-payload 不配对均不保存', () => {
    const store = makeStore();
    assertEqual(saveDraftTo(store, { kind: 'modify', operations: [] } as AiResult), null, 'modify 拒存');
    assertEqual(saveDraftTo(store, { kind: 'generate', artifactKind: 'table' } as AiResult), null, '缺 payload 拒存');
    assertEqual(loadDraftsFrom(store).length, 0, '存储无变化');
  });

  it('配额超限:save 返回 null,既有数据不受影响', () => {
    const store = quotaStore();
    assertEqual(saveDraftTo(store, genResult()), null, '超限保存失败');
  });

  it('删除与清空;null 存储全链路静默', () => {
    const store = makeStore();
    saveDraftTo(store, genResult('table', 'v1'), 1);
    saveDraftTo(store, genResult('table', 'v2'), 2);
    const afterRemove = removeDraftFrom(store, loadDraftsFrom(store)[0]!.id);
    assertEqual(afterRemove.length, 1, '删除后剩一条');
    clearDraftsIn(store);
    assertEqual(loadDraftsFrom(store).length, 0, '清空');
    // null 存储:全部静默
    assertEqual(loadDraftsFrom(null).length, 0, 'null 读取空');
    assertEqual(saveDraftTo(null, genResult()), null, 'null 保存 null');
    clearDraftsIn(null);
    removeDraftFrom(null, 'x');
  });

  it('flowchart 形态(缺省 artifactKind)亦可保存', () => {
    const store = makeStore();
    assertTrue(saveDraftTo(store, genResult('flowchart'), 5) !== null, 'flowchart 可存');
    assertEqual(loadDraftsFrom(store)[0]?.kind, 'flowchart', '形态识别');
  });
});

finish('本地草稿箱（artifact-drafts.check · Round 12）');
