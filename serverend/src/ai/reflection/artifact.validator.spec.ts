// 语图技术方案 - 多形态产物结构校验器单测(multi-artifact-batch Round 5)
// 覆盖三条关键路径:
//   ① 各形态结构遍历:error 级问题(重复 id/单子链/空白单元格/过少项)正确产出且阻断;
//   ② warning 级问题(—占比过高/重名/无时间推进)产出但不阻断;
//   ③ evaluator 分发:artifact 分支复用 error/warning 分级语义;格式层失败时跳过结构遍历。
import { validateArtifact, measureMindMap, measureTable } from './artifact.validator';
import { ReflectionEvaluator } from './evaluator';
import { MindMapNode } from '../schemas/artifact.schema';

/** 合法脑图:2 层、7 节点、无单子链 */
function goodMindmap(): { root: MindMapNode } {
  return {
    root: {
      id: 'm1',
      label: '主题',
      children: [
        { id: 'm2', label: '分支一', children: [{ id: 'm4', label: '要点a', children: [] }, { id: 'm5', label: '要点b', children: [] }] },
        { id: 'm3', label: '分支二', children: [{ id: 'm6', label: '要点c', children: [] }, { id: 'm7', label: '要点d', children: [] }] },
      ],
    },
  };
}

describe('多形态产物结构校验器(multi-artifact-batch Round 5)', () => {
  // ---- ① mindmap ----
  it('① mindmap:合法树通过;重复 id / 单子链 / 过深为 error', () => {
    expect(validateArtifact({ kind: 'mindmap', data: goodMindmap() }).valid).toBe(true);

    // 重复 id:渲染主键冲突
    const dupId = goodMindmap();
    (dupId.root.children[0] as MindMapNode).children[0]!.id = 'm1';
    const dupResult = validateArtifact({ kind: 'mindmap', data: dupId });
    expect(dupResult.valid).toBe(false);
    expect(dupResult.blockingIssues.some((i) => i.type === 'MINDMAP_DUP_ID')).toBe(true);

    // 单子链:层级冗余
    const chain = { root: { id: 'r', label: '根', children: [{ id: 'c1', label: '一', children: [] }] } };
    const chainResult = validateArtifact({ kind: 'mindmap', data: chain });
    expect(chainResult.valid).toBe(false);
    expect(chainResult.blockingIssues.some((i) => i.type === 'MINDMAP_SINGLE_CHILD')).toBe(true);

    // 过深:6 层(根→6)
    let deep: MindMapNode = { id: 'd6', label: '六', children: [] };
    for (let i = 5; i >= 1; i -= 1) deep = { id: `d${i}`, label: `层${i}`, children: [deep] };
    const deepResult = validateArtifact({ kind: 'mindmap', data: { root: deep } });
    expect(deepResult.blockingIssues.some((i) => i.type === 'MINDMAP_TOO_DEEP')).toBe(true);
  });

  it('① mindmap 指标:计数/深度/同级重名检测正确', () => {
    const m = measureMindMap(goodMindmap().root);
    expect(m.total).toBe(7);
    expect(m.maxDepth).toBe(3);
    expect(m.singleChildParents).toEqual([]);

    const dupLabel = goodMindmap();
    (dupLabel.root.children[0] as MindMapNode).children[1]!.label = '要点a';
    expect(measureMindMap(dupLabel.root).duplicateSiblingLabelIds).toContain('m5');
  });

  // ---- ① table ----
  it('① table:空白单元格/重复列名为 error;— 占比过高为 warning', () => {
    const good = {
      columns: ['维度', 'A', 'B'],
      rows: [
        ['成本', '高', '低'],
        ['工期', '3 月', '2 周'],
      ],
    };
    expect(validateArtifact({ kind: 'table', data: good }).valid).toBe(true);

    // 空白单元格(应写—):error
    const blank = { columns: ['维度', 'A'], rows: [['成本', '   ']] };
    const blankResult = validateArtifact({ kind: 'table', data: blank });
    expect(blankResult.valid).toBe(false);
    expect(blankResult.blockingIssues.some((i) => i.type === 'TABLE_EMPTY_CELL')).toBe(true);

    // 重复列名:error
    const dupCol = { columns: ['维度', '成本', '成本'], rows: [['A', '1', '2'], ['B', '3', '4']] };
    expect(validateArtifact({ kind: 'table', data: dupCol }).blockingIssues.some((i) => i.type === 'TABLE_DUP_COLUMN')).toBe(true);

    // — 占比 50%:仅 warning,不阻断(信息量提示)
    const sparse = { columns: ['维度', 'A', 'B'], rows: [['成本', '—', '—'], ['工期', '—', '低']] };
    const sparseResult = validateArtifact({ kind: 'table', data: sparse });
    expect(sparseResult.valid).toBe(true);
    expect(sparseResult.warnings.some((i) => i.type === 'TABLE_TOO_SPARSE')).toBe(true);
  });

  it('① table 指标:空/— 单元格计数正确', () => {
    const m = measureTable({ columns: ['a', 'b'], rows: [['—', ''], ['x', '—']] });
    expect(m.totalCells).toBe(4);
    expect(m.dashCells).toBe(2);
    expect(m.emptyCells).toBe(1);
  });

  // ---- ① checklist ----
  it('① checklist:总项数过少/组内重复项为 error;分组重名为 warning', () => {
    const good = {
      groups: [
        { title: '准备', items: [{ text: '买票' }, { text: '订酒店' }] },
        { title: '出发', items: [{ text: '查路况' }] },
      ],
    };
    expect(validateArtifact({ kind: 'checklist', data: good }).valid).toBe(true);

    // 单项清单:error
    const single = { groups: [{ title: '准备', items: [{ text: '买票' }] }] };
    expect(validateArtifact({ kind: 'checklist', data: single }).blockingIssues.some((i) => i.type === 'CHECKLIST_TOO_SMALL')).toBe(true);

    // 组内重复项:error
    const dup = { groups: [{ title: '准备', items: [{ text: '买票' }, { text: '买票' }] }] };
    expect(validateArtifact({ kind: 'checklist', data: dup }).blockingIssues.some((i) => i.type === 'CHECKLIST_DUP_ITEM')).toBe(true);

    // 分组标题重复:warning
    const dupGroup = {
      groups: [
        { title: '准备', items: [{ text: 'a' }, { text: 'b' }] },
        { title: '准备', items: [{ text: 'c' }, { text: 'd' }] },
      ],
    };
    const dupGroupResult = validateArtifact({ kind: 'checklist', data: dupGroup });
    expect(dupGroupResult.valid).toBe(true);
    expect(dupGroupResult.warnings.some((i) => i.type === 'CHECKLIST_DUP_GROUP')).toBe(true);
  });

  // ---- ① timeline ----
  it('① timeline:合法通过;时间全相同/标题重复为 warning(不阻断)', () => {
    const good = {
      events: [
        { time: 'Day1', title: '抵达' },
        { time: 'Day2', title: '返程' },
      ],
    };
    expect(validateArtifact({ kind: 'timeline', data: good }).valid).toBe(true);

    const flat = {
      events: [
        { time: 'Day1', title: '爬山' },
        { time: 'Day1', title: '爬山' },
      ],
    };
    const flatResult = validateArtifact({ kind: 'timeline', data: flat });
    expect(flatResult.valid).toBe(true);
    expect(flatResult.warnings.some((i) => i.type === 'TIMELINE_NO_PROGRESS')).toBe(true);
    expect(flatResult.warnings.some((i) => i.type === 'TIMELINE_DUP_TITLE')).toBe(true);
  });

  // ---- 防御性 ----
  it('脏数据遍历失败时按格式错误反馈,不抛出', () => {
    const result = validateArtifact({ kind: 'table', data: null });
    expect(result.valid).toBe(false);
    expect(result.blockingIssues[0]?.type).toBe('ARTIFACT_TRAVERSE_FAILED');
  });

  // ---- ③ evaluator 分发 ----
  it('③ evaluator:artifact 分支完成「Zod 格式 + 结构遍历」两层校验', () => {
    const evaluator = new ReflectionEvaluator();
    // 格式层失败(缺 root)
    const badFormat = evaluator.evaluate({ kind: 'artifact', artifactKind: 'mindmap', data: { foo: 1 } });
    expect(badFormat.valid).toBe(false);
    expect(badFormat.issues.some((i) => i.layer === 'format')).toBe(true);
    // 格式失败时不再叠加结构层噪音
    expect(badFormat.issues.every((i) => i.layer === 'format')).toBe(true);

    // 格式通过 + 结构问题(单子链)
    const structural = evaluator.evaluate({
      kind: 'artifact',
      artifactKind: 'mindmap',
      data: { root: { id: 'r', label: '根', children: [{ id: 'c', label: '一', children: [] }] } },
    });
    expect(structural.valid).toBe(false);
    expect(structural.blockingIssues.some((i) => i.type === 'MINDMAP_SINGLE_CHILD')).toBe(true);

    // 完全合法
    const ok = evaluator.evaluate({ kind: 'artifact', artifactKind: 'mindmap', data: goodMindmap() });
    expect(ok.valid).toBe(true);
  });

  it('③ evaluator:既有 generate/modify 分支行为不受影响(回归)', () => {
    const evaluator = new ReflectionEvaluator();
    // 合法 FlowDraft(有 start/end/连通)仍走 GraphValidator 正常校验
    const ok = evaluator.evaluate({
      kind: 'generate',
      draft: {
        nodes: [
          { id: 'n1', label: '开始', type: 'start' },
          { id: 'n2', label: '处理', type: 'process' },
          { id: 'n3', label: '结束', type: 'end' },
        ],
        edges: [
          { id: 'e1', source: 'n1', target: 'n2' },
          { id: 'e2', source: 'n2', target: 'n3' },
        ],
      },
    });
    expect(ok.valid).toBe(true);
    expect(ok.structure).not.toBeNull();
  });
});
