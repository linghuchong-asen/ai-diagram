// 语图技术方案 - Task 5（AI 浮窗）可执行断言脚本
// 覆盖浮窗纯逻辑层 session/ai-flow-logic.ts：
//   canvas 摘要提取（toCanvasSummaries）/ generate 合并避让（mergeGeneratedIntoCanvas）/
//   modify 快照拼回（restoreSnapshotToX6Data）/ 真实结果反馈文案（summarizeApplyReport 等）/
//   resumeToken 透传提取（extractResumeToken）。
// 运行：cd frontend && npx tsx src/pages/ai/__checks__/ai-flow.check.ts

import type { CanvasNodeSummary } from '../../../utils/aiClient';
import type { ApplyReport, ApplyOperationResult, SkipReason } from '../match/apply-operations';
import type { CanvasSnapshot } from '../match/match-level';
import type { X6GraphData } from '../transform/types';
import { NODE_GAP } from '../layout/auto-layout';
import {
  extractResumeToken,
  formatResidualLines,
  mergeGeneratedIntoCanvas,
  restoreSnapshotToX6Data,
  SKIP_REASON_TEXT,
  summarizeApplyReport,
  summarizeGeneratePreview,
  toCanvasSummaries,
} from '../session/ai-flow-logic';
import {
  assertClose,
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
  at,
  describe,
  finish,
  it,
} from './check-util';

describe('toCanvasSummaries：画布摘要提取', () => {
  it('FlowNode → CanvasNodeSummary 字段一一对应', () => {
    const out = toCanvasSummaries([
      { id: 'n1', label: '开始', type: 'start' },
      { id: 'n2', label: '审批', type: 'process' },
    ]);
    assertEqual(out.length, 2, '应保留 2 个节点');
    const first: CanvasNodeSummary = at(out, 0, '第一个节点应存在');
    assertDeepEqual(first, { id: 'n1', label: '开始', type: 'start' }, '摘要字段应一致');
  });

  it('剔除空 id、按 id 去重，保持顺序', () => {
    const out = toCanvasSummaries([
      { id: '', label: '无id', type: 'process' },
      { id: 'a', label: 'A', type: 'process' },
      { id: 'a', label: 'A重复', type: 'process' },
      { id: 'b', label: '', type: 'end' },
    ]);
    assertEqual(out.length, 2, '空 id 剔除 + 去重后应剩 2 个');
    assertEqual(at(out, 0, 'a').id, 'a', '第一个应为 a');
    assertEqual(at(out, 0, 'a').label, 'A', '去重保留首个');
    assertEqual(at(out, 1, 'b').label, '', '空 label 保留为空串');
  });

  it('空输入返回空数组', () => {
    assertEqual(toCanvasSummaries([]).length, 0, '空输入应为空数组');
  });
});

describe('mergeGeneratedIntoCanvas：generate 应用合并', () => {
  const generated = {
    nodes: [
      {
        id: 'g1',
        shape: 'ellipse',
        x: 60,
        y: 60,
        width: 120,
        height: 50,
        attrs: {},
        data: { nodeType: 'start', label: '开始', degraded: false },
      },
      {
        id: 'g2',
        shape: 'rect',
        x: 240,
        y: 60,
        width: 140,
        height: 50,
        attrs: {},
        data: { nodeType: 'process', label: '处理', degraded: false },
      },
    ],
    edges: [
      { id: 'e1', shape: 'edge', source: { cell: 'g1' }, target: { cell: 'g2' }, attrs: {} },
    ],
  } as X6GraphData;

  it('画布为空：生成内容原样写入（cells 拼接）', () => {
    const merged = mergeGeneratedIntoCanvas(undefined, generated);
    assertEqual(merged.cells.length, 3, '空画布应得 2 节点 + 1 边');
    const node = at(merged.cells, 0, 'g1');
    assertDeepEqual((node as { x: number }).x, 60, '空画布不平移');
  });

  it('画布非空：既有单元原样保留，生成图整体右移避让（零重叠）', () => {
    const existing = {
      cells: [
        { id: 'u1', shape: 'rect', x: 0, y: 0, width: 140, height: 50, attrs: {} },
        { id: 'ue1', shape: 'edge', source: { cell: 'u1' }, target: { cell: 'u1' }, attrs: {} },
      ],
    };
    const merged = mergeGeneratedIntoCanvas(existing, generated, NODE_GAP);
    assertEqual(merged.cells.length, 5, '2 既有 + 2 新节点 + 1 新边');

    const existingNode = at(merged.cells, 0, 'u1') as { x: number };
    assertEqual(existingNode.x, 0, '既有节点坐标不得被改动');

    const g1 = at(merged.cells, 2, 'g1') as { x: number; width: number };
    // 既有右边缘 140 + gap → 生成图最左节点应右移至 140 + NODE_GAP
    assertClose(g1.x, 140 + NODE_GAP, '生成图应平移到既有内容右侧');
    assertTrue(g1.x >= 140, '不得与既有节点重叠');

    const edge = at(merged.cells, 4, 'e1') as { source: { cell: string }; target: { cell: string } };
    assertEqual(edge.source.cell, 'g1', '边端点不因平移改变');
    assertEqual(edge.target.cell, 'g2', '边端点不因平移改变');

    // 新图整体内部相对位置保持
    const g2 = at(merged.cells, 3, 'g2') as { x: number };
    assertClose(g2.x - g1.x, 180, '内部相对间距保持');
  });

  it('生成图已在既有内容右侧：不做多余平移', () => {
    const existing = { cells: [{ id: 'u1', shape: 'rect', x: 0, y: 0, width: 50, attrs: {} }] };
    const farGenerated = {
      nodes: [{ id: 'g1', shape: 'rect', x: 1000, y: 0, width: 140, height: 50 }],
      edges: [],
    };
    const merged = mergeGeneratedIntoCanvas(existing, farGenerated, NODE_GAP);
    const g1 = at(merged.cells, 1, 'g1') as { x: number };
    assertEqual(g1.x, 1000, '已在右侧时不平移');
  });
});

describe('restoreSnapshotToX6Data：modify 快照拼回', () => {
  const snapshot: CanvasSnapshot = {
    nodes: [
      {
        id: 'n1',
        label: '提交申请',
        type: 'process',
        x: 120,
        y: 80,
        width: 140,
        height: 50,
        visual: { fillColor: '#FFF2E8' },
      },
      { id: 'n2', label: '审批', type: 'decision', x: 300, y: 60, width: 140, height: 80 },
    ],
    edges: [
      { id: 'ed1', source: 'n1', target: 'n2', label: '通过', visual: { borderStyle: 'dashed' } },
    ],
  };

  it('坐标/label/type 原样拼回，origin 为 ai-modify', () => {
    const data = restoreSnapshotToX6Data(snapshot);
    assertEqual(data.nodes.length, 2, '节点数一致');
    const n1 = at(data.nodes, 0, 'n1');
    assertClose(n1.x, 120, 'n1.x 保留用户坐标');
    assertClose(n1.y, 80, 'n1.y 保留用户坐标');
    assertDeepEqual(n1.data?.label, '提交申请', 'label 拼回');
    assertDeepEqual(n1.data?.nodeType, 'process', 'type 拼回');
    assertDeepEqual(n1.data?.origin, 'ai-modify', 'origin 应为 ai-modify');
    const n2 = at(data.nodes, 1, 'n2');
    assertDeepEqual(n2.data?.nodeType, 'decision', 'decision 类型拼回');
    const edge = at(data.edges, 0, 'ed1');
    assertDeepEqual(edge.data?.origin, 'ai-modify', '边 origin 应为 ai-modify');
  });

  it('节点与边的 visual 均被恢复（fillColor / dashed）', () => {
    const data = restoreSnapshotToX6Data(snapshot);
    const n1 = at(data.nodes, 0, 'n1');
    assertDeepEqual((n1.attrs?.body?.fillColor as unknown) ?? n1.attrs?.body?.fill, '#FFF2E8', '节点填充色恢复');
    const edge = at(data.edges, 0, 'ed1');
    assertDeepEqual(edge.attrs?.line?.strokeDasharray, '6 3', '边虚线样式恢复');
    // flowDraftToX6 对带 label 的边生成 labels，文字应回填
    const label = edge.labels?.[0]?.attrs?.label?.text;
    assertDeepEqual(label, '通过', '边标签拼回');
  });

  it('空快照返回空图数据，不抛异常', () => {
    const data = restoreSnapshotToX6Data({ nodes: [], edges: [] });
    assertEqual(data.nodes.length, 0, '空节点');
    assertEqual(data.edges.length, 0, '空边');
  });
});

// ---------------------------------------------------------------------------
// 结果反馈文案（真实 applied/residual，无硬编码）
// ---------------------------------------------------------------------------

function result(partial: Partial<ApplyOperationResult>): ApplyOperationResult {
  return {
    index: 0,
    kind: 'modify_node',
    ok: false,
    level: 'none',
    confidence: 0,
    reason: '',
    ...partial,
  };
}

function fakeReport(results: ApplyOperationResult[]): ApplyReport {
  return {
    snapshot: { nodes: [], edges: [] },
    results,
    appliedCount: results.filter((item) => item.ok).length,
    skippedCount: results.filter((item) => !item.ok).length,
    residual: results.filter((item) => !item.ok && item.skip !== 'unselected'),
  };
}

describe('summarizeApplyReport / formatResidualLines：真实结果反馈', () => {
  it('全部成功：只报应用数，无残差', () => {
    const report = fakeReport([
      result({ index: 0, ok: true, level: 'L1', confidence: 1, targetId: 'n1', reason: 'ok' }),
    ]);
    const text = summarizeApplyReport(report);
    assertTrue(text.includes('已应用 1 项'), '应报真实应用数');
    assertFalse(text.includes('无法执行'), '无残差时不应出现无法执行');
  });

  it('残差按 unmatched/ambiguous/duplicate/invalid 归因逐行列出', () => {
    const report = fakeReport([
      result({ index: 0, ok: true, level: 'L1', confidence: 1, reason: 'ok' }),
      result({ index: 1, skip: 'unselected', reason: '用户未勾选，已跳过' }),
      result({ index: 2, skip: 'unmatched', reason: '未找到「不存在」' }),
      result({ index: 3, skip: 'ambiguous', reason: '两个同名候选' }),
      result({ index: 4, skip: 'duplicate', reason: '已存在同名节点' }),
      result({ index: 5, skip: 'invalid', reason: '未知 op' }),
    ]);
    const text = summarizeApplyReport(report);
    assertTrue(text.includes('已应用 1 项'), 'appliedCount = 1');
    assertTrue(text.includes('4 项无法执行'), 'residual = 4 项（不含 unselected）');
    const lines = formatResidualLines(report);
    assertEqual(lines.length, 4, '残差清单不含 unselected');
    assertTrue(lines.join('\n').includes(SKIP_REASON_TEXT.unmatched), '含未匹配归因');
    assertTrue(lines.join('\n').includes(SKIP_REASON_TEXT.ambiguous), '含歧义归因');
    assertTrue(lines.join('\n').includes(SKIP_REASON_TEXT.duplicate), '含重复归因');
    assertTrue(lines.join('\n').includes(SKIP_REASON_TEXT.invalid), '含非法归因');
    assertFalse(text.includes('已应用 5 项修改'), '不得出现旧的硬编码假文案');
  });

  it('空报告 / null 安全降级', () => {
    assertDeepEqual(summarizeApplyReport(null), '修改未执行。', 'null 降级文案');
    assertEqual(formatResidualLines(undefined).length, 0, 'undefined 残差为空');
  });
});

describe('summarizeGeneratePreview：generate 预览摘要', () => {
  it('含节点/连线数与后续动作提示', () => {
    const text = summarizeGeneratePreview(4, 3, 0, 0);
    assertTrue(text.includes('4 个节点'), '应含节点数');
    assertTrue(text.includes('3 条连线'), '应含连线数');
    assertTrue(text.includes('应用到画布'), '应引导用户应用');
  });

  it('dropped / degraded 提示不静默', () => {
    const text = summarizeGeneratePreview(4, 5, 2, 1);
    assertTrue(text.includes('2 条连线因端点缺失被丢弃'), '悬空边提示');
    assertTrue(text.includes('1 个节点类型非法已降级'), '降级提示');
  });
});

describe('extractResumeToken：resumeToken 透传', () => {
  it('字符串原样提取并 trim', () => {
    assertDeepEqual(extractResumeToken({ reason: '', issues: [], candidates: [], resumeToken: ' tok-1 ' }), 'tok-1', '应 trim');
  });

  it('缺失 / 非字符串 / 空串 → undefined', () => {
    assertDeepEqual(extractResumeToken({ reason: '', issues: [], candidates: [] }), undefined, '缺字段');
    assertDeepEqual(
      extractResumeToken({ reason: '', issues: [], candidates: [], resumeToken: 123 as unknown as string }),
      undefined,
      '非字符串',
    );
    assertDeepEqual(extractResumeToken({ reason: '', issues: [], candidates: [], resumeToken: '   ' }), undefined, '空串');
  });

  it('超长截断到 128', () => {
    const token = extractResumeToken({
      reason: '',
      issues: [],
      candidates: [],
      resumeToken: 'x'.repeat(200),
    });
    assertDeepEqual(token?.length, 128, '应截断到 128');
  });
});

finish('ai-flow.check');
