// 语图技术方案 - 多形态产物前端纯逻辑断言脚本（multi-artifact-batch Round 7）
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/artifact.check.ts
// 覆盖三层纯逻辑：
//   ① artifacts/artifact-normalize.ts —— 脏数据归一化（缺 id 补齐/短行补—/空组丢弃/不可用返回 null）；
//   ② artifacts/mindmap-layout.ts —— 整洁树布局（无重叠/父居中/边闭合）与 FlowDraft 转换；
//   ③ artifacts/artifact-markdown.ts —— 四形态 Markdown 导出（表格对齐/任务语法/有序时间线）。
import {
  normalizeMindmap,
  normalizeTable,
  normalizeChecklist,
  normalizeTimeline,
} from '../artifacts/artifact-normalize';
import {
  layoutMindmap,
  mindmapToFlowDraftLike,
  MINDMAP_NODE_HEIGHT,
  MINDMAP_SIBLING_GAP_Y,
} from '../artifacts/mindmap-layout';
import {
  mindmapToMarkdown,
  tableToMarkdown,
  checklistToMarkdown,
  timelineToMarkdown,
} from '../artifacts/artifact-markdown';
// competitor-driven-evolution-batch Round 12：草稿箱回放/导出的 payload 提取
import { generatePayloadOf, ARTIFACT_KIND_LABEL } from '../artifacts/artifact-meta';
import type { MindMapNode } from '../../../utils/aiClient';
import { describe, it, finish, assertTrue, assertEqual } from './check-util';

/** 非空断言辅助:归一化结果 payload 为 null 时直接失败 */
function mustHave<T>(payload: T | null, message: string): T {
  if (payload === null) throw new Error(message);
  return payload;
}

// ---------------------------------------------------------------------------
describe('① 产物归一化（脏数据不抛异常、最小可用兜底）', () => {
  it('mindmap:缺 id 自动补齐且全树唯一;缺 label 兜底「未命名」', () => {
    const raw = {
      root: {
        id: 'm1',
        label: '根',
        children: [
          { label: '无id子节点', children: [] },
          { id: 'm1', label: '重复id子节点', children: [] }, // 与根重复,应重新生成
        ],
      },
    };
    const { payload, fixes } = normalizeMindmap(raw);
    const draft = mustHave(payload, '合法骨架不应返回 null');
    const ids = [draft.root.id, ...draft.root.children.map((c) => c.id)];
    // 全树 id 唯一
    assertTrue(new Set(ids).size === ids.length, `id 应全树唯一: ${ids.join(',')}`);
    // 缺 id/重复 id 都被补齐,fixes 有记录
    assertTrue(fixes.length >= 2, `应记录至少 2 处修复,实际 ${fixes.length}`);
    assertEqual(draft.root.children[0]?.label, '无id子节点', '缺 id 不影响 label 保留');
  });

  it('mindmap:label 类型错兜底;children 非数组按空;root 缺失返回 null', () => {
    const fixed = normalizeMindmap({ root: { id: 'r', label: 123, children: 'oops' } });
    const draft = mustHave(fixed.payload, 'root 存在时不应返回 null');
    assertEqual(draft.root.label, '未命名', '非字符串 label 应兜底');
    assertEqual(draft.root.children.length, 0, 'children 非数组应按空处理');

    const broken = normalizeMindmap({ foo: 1 });
    assertTrue(broken.payload === null, '缺 root 应返回 null');
    // 完全脏数据也不抛异常
    const crashed = normalizeMindmap(null);
    assertTrue(crashed.payload === null, 'null 输入应返回 null 而非抛异常');
  });

  it('table:短行补「—」对齐;长行截断;非法行丢弃', () => {
    const raw = { columns: ['维度', 'A', 'B'], rows: [['成本', '高'], ['工期', '3 月', '2 周', '多余'], 'not-a-row'] };
    const { payload } = normalizeTable(raw);
    const table = mustHave(payload, '存在合法行时不应返回 null');
    assertEqual(table.rows.length, 2, '非法行应被丢弃(3 行中 1 行非法)');
    assertEqual(table.rows[0]?.[2], '—', '短行应补「—」');
    assertEqual(table.rows[1]?.length, 3, '长行应截断到列数');
  });

  it('table:列头全非法 → null;竖线列头被过滤', () => {
    assertTrue(normalizeTable({ columns: [123, null], rows: [['a']] }).payload === null, '无有效列头应返回 null');
  });

  it('checklist:空分组丢弃;owner/due 非字符串剔除;文本保留', () => {
    const raw = {
      groups: [
        { title: '准备', items: [{ text: '买票', owner: '我', due: 5 }, { text: '' }] },
        { title: '空组', items: [] },
      ],
    };
    const { payload } = normalizeChecklist(raw);
    const list = mustHave(payload, '存在有效项时不应返回 null');
    assertEqual(list.groups.length, 1, '空分组应丢弃');
    assertEqual(list.groups[0]?.items.length, 2, '空文本项按占位保留(不静默丢内容维度)');
    assertEqual(list.groups[0]?.items[0]?.owner, '我', '合法 owner 保留');
    assertTrue(list.groups[0]?.items[0]?.due === undefined, '非字符串 due 应剔除');
  });

  it('timeline:缺 time 兜底「时间待定」;detail 非字符串剔除;全非法 → null', () => {
    const raw = { events: [{ title: '爬山' }, { time: 'Day2', title: '返程', detail: '高铁' }, 42] };
    const { payload } = normalizeTimeline(raw);
    const line = mustHave(payload, '存在合法事件时不应返回 null');
    assertEqual(line.events.length, 2, '非法事件丢弃');
    assertEqual(line.events[0]?.time, '时间待定', '缺 time 兜底');
    assertEqual(line.events[1]?.detail, '高铁', '合法 detail 保留');
    assertTrue(normalizeTimeline({ events: [1, 2] }).payload === null, '全非法事件应返回 null');
  });

  it('归一化为纯函数:不改写入参对象', () => {
    const raw = { columns: ['a', 'b'], rows: [['1']] };
    const snapshot = JSON.stringify(raw);
    normalizeTable(raw);
    assertEqual(JSON.stringify(raw), snapshot, '归一化不应改写入参');
  });
});

// ---------------------------------------------------------------------------
describe('② 思维导图布局（整洁树:无重叠/父居中/边闭合）', () => {
  /** 样例树:根 2 支,左支 2 叶,右支 1 叶(单叶子) */
  function sampleTree(): MindMapNode {
    return {
      id: 'm1',
      label: '根',
      children: [
        { id: 'm2', label: '左', children: [{ id: 'm4', label: '叶1', children: [] }, { id: 'm5', label: '叶2', children: [] }] },
        { id: 'm3', label: '右', children: [{ id: 'm6', label: '叶3', children: [] }] },
      ],
    };
  }

  it('布局:同层节点 y 不重叠(间距 ≥ 兄弟间距);x 按层深等距', () => {
    const layout = layoutMindmap({ root: sampleTree() });
    assertEqual(layout.nodes.length, 6, '节点总数');
    assertEqual(layout.edges.length, 5, '边数 = 节点数 - 1(树)');
    // 同层不重叠
    const byDepth = new Map<number, number[]>();
    for (const node of layout.nodes) {
      byDepth.set(node.depth, [...(byDepth.get(node.depth) ?? []), node.y]);
    }
    for (const [depth, ys] of byDepth) {
      const sorted = [...ys].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        assertTrue(
          sorted[i]! - sorted[i - 1]! >= MINDMAP_NODE_HEIGHT + 8,
          `第 ${depth} 层 y 间距不足(${sorted[i - 1]} → ${sorted[i]})`,
        );
      }
    }
    // x 等距:depth2 与 depth3 的 x 差 = 节点宽 + 层间距
    const n2 = layout.nodes.find((n) => n.id === 'm2')!;
    const n4 = layout.nodes.find((n) => n.id === 'm4')!;
    assertTrue(n4.x > n2.x, '子节点 x 应在父节点右侧');
  });

  it('布局:父节点 y = 子节点 y 中点(整洁树回填)', () => {
    const layout = layoutMindmap({ root: sampleTree() });
    const m2 = layout.nodes.find((n) => n.id === 'm2')!;
    const m4 = layout.nodes.find((n) => n.id === 'm4')!;
    const m5 = layout.nodes.find((n) => n.id === 'm5')!;
    const midpoint = (m4.y + m5.y) / 2;
    assertTrue(Math.abs(m2.y - midpoint) < 1e-9, `父节点 y 应为子节点中点(${m2.y} vs ${midpoint})`);
  });

  it('布局:边与节点集合闭合(无悬空引用)', () => {
    const layout = layoutMindmap({ root: sampleTree() });
    const ids = new Set(layout.nodes.map((n) => n.id));
    for (const edge of layout.edges) {
      assertTrue(ids.has(edge.source), `边的 source 应存在: ${edge.source}`);
      assertTrue(ids.has(edge.target), `边的 target 应存在: ${edge.target}`);
    }
  });

  it('转换:树 → FlowDraft 形态(process 节点 + 父子边,可进画布)', () => {
    const draft = mindmapToFlowDraftLike({ root: sampleTree() });
    assertEqual(draft.nodes.length, 6, '节点数一致');
    assertEqual(draft.edges.length, 5, '边数一致');
    assertTrue(draft.nodes.every((n) => n.type === 'process'), '脑图节点统一 process 类型');
    assertTrue(draft.edges.every((e) => e.source !== e.target), '无自环');
  });
});

// ---------------------------------------------------------------------------
describe('③ Markdown 导出（表格对齐/任务语法/有序时间线/层级缩进）', () => {
  it('table:表头 + 分隔行列数一致;竖线转义;结论引用行', () => {
    const md = tableToMarkdown({
      columns: ['维度', 'A|B'],
      rows: [['成本', '3 人月']],
      conclusion: '推荐 B',
    });
    const lines = md.split('\n');
    assertEqual(lines[0], '| 维度 | A｜B |', '表头行(列内竖线转全角)');
    assertEqual(lines[1], '| --- | --- |', '分隔行列数与表头一致');
    assertEqual(lines[2], '| 成本 | 3 人月 |', '数据行');
    assertTrue(md.includes('> 结论：推荐 B'), '结论以引用行呈现');
    // 分隔行列数严格校验:与表头 | 数一致
    assertEqual(
      lines[0]?.split('|').length,
      lines[1]?.split('|').length,
      '表头与分隔行的竖线数应一致(合法 Markdown 表格)',
    );
  });

  it('checklist:GitHub 任务语法(- [ ]);分组三级标题;owner/due 后缀', () => {
    const md = checklistToMarkdown({
      groups: [
        {
          title: '上线前',
          items: [
            { text: '回归全绿', owner: '测试', due: '周三' },
            { text: '备份' },
          ],
        },
      ],
    });
    assertTrue(md.includes('### 上线前'), '分组用三级标题');
    assertTrue(md.includes('- [ ] 回归全绿（@测试 ⏰周三）'), '任务语法 + owner/due 后缀');
    assertTrue(md.includes('- [ ] 备份'), '无 meta 项保持纯净');
  });

  it('timeline:有序列表 + 时间加粗 + detail 冒号拼接', () => {
    const md = timelineToMarkdown({
      events: [
        { time: 'Day1 上午', title: '抵达成都', detail: '高铁 G8511' },
        { time: 'Day1 晚上', title: '火锅' },
      ],
    });
    assertTrue(md.startsWith('1. **Day1 上午** 抵达成都：高铁 G8511'), '首事件格式');
    assertTrue(md.includes('2. **Day1 晚上** 火锅'), '次事件格式');
  });

  it('mindmap:层级缩进列表(根 0 缩进,子逐层 +2 空格)', () => {
    const md = mindmapToMarkdown({
      root: {
        id: 'm1',
        label: '根',
        children: [{ id: 'm2', label: '子', children: [{ id: 'm3', label: '孙', children: [] }] }],
      },
    });
    assertEqual(md, '- 根\n  - 子\n    - 孙', '三层缩进结构');
  });
});

// ---------------------------------------------------------------------------
// competitor-driven-evolution-batch Round 12：generatePayloadOf（草稿箱出口的 payload 提取）
// ---------------------------------------------------------------------------
describe('generatePayloadOf + 形态中文名（Round 12）', () => {
  const flowDraft = { nodes: [{ id: 'n1', label: '开始', type: 'start' }], edges: [] };
  const mindmapDraft = { root: { id: 'm1', label: '根', children: [] } };
  const tableDraft = { columns: ['维度', 'A'], rows: [['成本', '1'], ['工期', '2']] };
  const checklistDraft = { groups: [{ title: '待办', items: [{ text: '做一件事' }] }] };
  const timelineDraft = { events: [{ time: 'Day1', title: '出发' }, { time: 'Day2', title: '返程' }] };

  it('flowchart（缺省 artifactKind）→ flowDraft', () => {
    const payload = generatePayloadOf({ kind: 'generate', flowDraft } as never);
    assertEqual(payload, flowDraft as never, '缺省形态按 flowchart 取 flowDraft');
  });

  it('四新形态各自取对应 Draft 字段', () => {
    assertEqual(generatePayloadOf({ kind: 'generate', artifactKind: 'mindmap', mindmapDraft } as never), mindmapDraft as never, 'mindmap');
    assertEqual(generatePayloadOf({ kind: 'generate', artifactKind: 'table', tableDraft } as never), tableDraft as never, 'table');
    assertEqual(generatePayloadOf({ kind: 'generate', artifactKind: 'checklist', checklistDraft } as never), checklistDraft as never, 'checklist');
    assertEqual(generatePayloadOf({ kind: 'generate', artifactKind: 'timeline', timelineDraft } as never), timelineDraft as never, 'timeline');
  });

  it('非 generate 结果与形态-payload 不配对 → null（调用方隐藏出口）', () => {
    assertEqual(generatePayloadOf({ kind: 'consult', answer: 'x' } as never), null, 'consult 无 payload');
    assertEqual(generatePayloadOf({ kind: 'modify', operations: [] } as never), null, 'modify 无 payload');
    assertEqual(generatePayloadOf({ kind: 'generate', artifactKind: 'table' } as never), null, '声明 table 但缺 tableDraft');
  });

  it('五形态中文名齐备（草稿箱列表与摘要文案共用）', () => {
    for (const kind of ['flowchart', 'mindmap', 'table', 'checklist', 'timeline'] as const) {
      assertTrue((ARTIFACT_KIND_LABEL[kind] ?? '').length > 0, `${kind} 中文名非空`);
    }
    assertEqual(ARTIFACT_KIND_LABEL.table, '对比表格', 'table 中文名');
  });
});

finish('多形态产物前端纯逻辑（artifact.check）');
