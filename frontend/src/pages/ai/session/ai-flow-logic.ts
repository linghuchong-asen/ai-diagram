// 语图技术方案 - Task 5：AI 浮窗纯逻辑层
// 职责：浮窗数据链路中的「可独立断言」部分，与 React / X6 运行时实例解耦：
//   1. toCanvasSummaries：画布 FlowDraft → CanvasNodeSummary[]（handleSend 的 canvas 摘要）；
//   2. mergeGeneratedIntoCanvas：generate 应用时「保留用户已有节点 + 整体右移避让」的合并纯函数；
//   3. restoreSnapshotToX6Data：modify 应用后把 report.snapshot 拼回 FlowDraft + positions/visuals
//      再走 flowDraftToX6（origin: 'ai-modify'），并补齐 flowDraftToX6 不支持的边 visual；
//   4. 结果反馈文案：generate 预览摘要 / modify 真实 applied/residual 摘要（替代旧的硬编码文案）；
//   5. extractResumeToken：人在回路 payload 里可能下发的恢复令牌（confirm 透传）。
// 纯函数、无副作用：不 import React / @antv/x6 运行时，输出全新对象。

import type { CanvasNodeSummary } from '../../../utils/aiClient';
import type { ApplyReport, SkipReason } from '../match/apply-operations';
import type { CanvasSnapshot } from '../match/match-level';
import { buildEdgeAttrs } from '../transform/node-type-config';
import { flowDraftToX6 } from '../transform/to-x6';
import type {
  FlowDraft,
  FlowEdge,
  Point,
  VisualChange,
  X6CellLike,
  X6GraphData,
  X6GraphJSON,
} from '../transform/types';

/** 生成内容与既有画布内容的最小间距（与 auto-layout 的 NODE_GAP 同源） */
import { NODE_GAP } from '../layout/auto-layout';

// ---------------------------------------------------------------------------
// 1) 画布语义摘要（ChatRequest.canvas）
// ---------------------------------------------------------------------------

/**
 * x6ToFlowDraft 产出的节点 → CanvasNodeSummary[]：
 * 剔除空 id、按 id 去重（后端 schema 要求 id 唯一），label 缺失降级为空字符串。
 */
export function toCanvasSummaries(
  nodes: readonly { id: string; label: string; type: CanvasNodeSummary['type'] }[],
): CanvasNodeSummary[] {
  const seen = new Set<string>();
  const out: CanvasNodeSummary[] = [];
  (Array.isArray(nodes) ? nodes : []).forEach((node) => {
    if (!node || typeof node.id !== 'string' || node.id.length === 0) return;
    if (seen.has(node.id)) return;
    seen.add(node.id);
    out.push({
      id: node.id,
      label: typeof node.label === 'string' ? node.label : '',
      type: node.type,
    });
  });
  return out;
}

// ---------------------------------------------------------------------------
// 2) generate 结果与既有画布合并（保留已有节点 + 避让）
// ---------------------------------------------------------------------------

/** 与 to-x6.ts 一致的边判定：shape==='edge' 或带 source/target（宽松读取，兼容三种 Cell 形态） */
function isEdgeCell(cell: X6CellLike): boolean {
  const record = cell as { shape?: unknown; source?: unknown; target?: unknown };
  return record.shape === 'edge' || record.source !== undefined || record.target !== undefined;
}

function existingCells(json: X6GraphJSON | undefined | null): X6CellLike[] {
  if (Array.isArray(json?.cells)) return [...(json?.cells as X6CellLike[])];
  const nodes = Array.isArray(json?.nodes) ? (json?.nodes as X6CellLike[]) : [];
  const edges = Array.isArray(json?.edges) ? (json?.edges as X6CellLike[]) : [];
  return [...nodes, ...edges];
}

/** 宽松读取既有单元的数值字段（X6CellJSON 有索引签名，NodeData/EdgeData 按字段名直取） */
function cellNumber(cell: X6CellLike, key: 'x' | 'width', fallback: number): number {
  const value = (cell as { x?: unknown; width?: unknown })[key];
  return typeof value === 'number' ? value : fallback;
}

/**
 * generate 应用到主画布：
 * - 画布为空 → 直接写入生成内容（整体替换语义不变）；
 * - 画布非空 → 保留全部既有单元，把生成图整体平移到既有内容右侧 gap 处（整体平移保证零重叠）。
 * 返回 { cells }（既有单元原样回灌），可整体 graph.fromJSON(...)。
 */
export function mergeGeneratedIntoCanvas(
  existing: X6GraphJSON | undefined | null,
  generated: X6GraphData,
  gap: number = NODE_GAP,
): { cells: X6CellLike[] } {
  const cells = existingCells(existing);
  const newNodes = Array.isArray(generated?.nodes) ? generated.nodes : [];
  const newEdges = Array.isArray(generated?.edges) ? generated.edges : [];

  const occupied = cells.filter((cell) => !isEdgeCell(cell));
  if (occupied.length === 0 || newNodes.length === 0) {
    return { cells: [...cells, ...newNodes, ...newEdges] };
  }

  // 既有内容右边缘（宽度缺省按 140 兜底）
  const maxRight = occupied.reduce(
    (max, cell) => Math.max(max, cellNumber(cell, 'x', 0) + cellNumber(cell, 'width', 140)),
    Number.NEGATIVE_INFINITY,
  );
  const minLeft = newNodes.reduce(
    (min, node) => Math.min(min, typeof node.x === 'number' ? node.x : 0),
    Number.POSITIVE_INFINITY,
  );
  const dx = Math.round(maxRight + gap - minLeft);

  const movedNodes = dx > 0 ? newNodes.map((node) => ({ ...node, x: node.x + dx })) : newNodes;
  return { cells: [...cells, ...movedNodes, ...newEdges] };
}

// ---------------------------------------------------------------------------
// 3) modify 应用后：快照拼回 X6 图数据
// ---------------------------------------------------------------------------

/**
 * CanvasSnapshot → X6GraphData：
 * 坐标取快照原值（用户拖过的位置不丢），节点 visual 经 flowDraftToX6 的 visuals 注入；
 * flowDraftToX6 不支持按边注入 visual，此处对 modify_edge 产生的边样式做补齐。
 */
export function restoreSnapshotToX6Data(snapshot: CanvasSnapshot | undefined | null): X6GraphData {
  const nodes = Array.isArray(snapshot?.nodes) ? snapshot?.nodes ?? [] : [];
  const edges = Array.isArray(snapshot?.edges) ? snapshot?.edges ?? [] : [];

  const draft: FlowDraft = {
    nodes: nodes.map((node) => ({ id: node.id, label: node.label, type: node.type })),
    edges: edges.map((edge): FlowEdge => {
      const out: FlowEdge = { id: edge.id, source: edge.source, target: edge.target };
      if (typeof edge.label === 'string' && edge.label.length > 0) out.label = edge.label;
      return out;
    }),
  };

  const positions: Record<string, Point> = {};
  const visuals: Record<string, VisualChange> = {};
  nodes.forEach((node) => {
    positions[node.id] = { x: node.x, y: node.y };
    if (node.visual) visuals[node.id] = node.visual;
  });

  const data = flowDraftToX6(draft, { positions, visuals, origin: 'ai-modify' });

  const edgeVisualById = new Map<string, VisualChange | undefined>();
  edges.forEach((edge) => edgeVisualById.set(edge.id, edge.visual));
  data.edges.forEach((edge) => {
    const visual = edgeVisualById.get(edge.id);
    if (visual) edge.attrs = buildEdgeAttrs(visual);
  });
  return data;
}

// ---------------------------------------------------------------------------
// 4) 结果反馈文案（真实结果，不做硬编码）
// ---------------------------------------------------------------------------

/** 残差归因中文短名（unmatched / ambiguous / duplicate / invalid） */
export const SKIP_REASON_TEXT: Record<SkipReason, string> = {
  unselected: '未勾选',
  unmatched: '未匹配到画布元素',
  ambiguous: '歧义未人工裁决',
  duplicate: '目标已存在（幂等跳过）',
  invalid: '操作结构非法',
};

/** 残差逐行清单：第 N 项（归因）：原因 */
export function formatResidualLines(report: ApplyReport | undefined | null): string[] {
  const residual = report?.residual ?? [];
  return residual.map(
    (item) => `第 ${item.index + 1} 项（${SKIP_REASON_TEXT[item.skip ?? 'invalid']}）：${item.reason}`,
  );
}

/** modify 应用结果摘要：真实 applied / unselected / residual 数量与归因 */
export function summarizeApplyReport(report: ApplyReport | undefined | null): string {
  if (!report) return '修改未执行。';
  const unselected = report.results.filter((item) => !item.ok && item.skip === 'unselected').length;
  const lines: string[] = [`已应用 ${report.appliedCount} 项修改`];
  if (unselected > 0) lines.push(`已按你的选择跳过 ${unselected} 项`);
  if (report.residual.length > 0) {
    lines.push(`${report.residual.length} 项无法执行：`);
    lines.push(...formatResidualLines(report));
  }
  return `${lines.join('；')}。`;
}

/** generate 预览摘要（含 droppedEdges / 降级节点提示，绝不静默丢弃） */
export function summarizeGeneratePreview(
  nodeCount: number,
  edgeCount: number,
  droppedEdgeCount: number,
  degradedNodeCount: number,
): string {
  const base = `已生成流程图预览：${nodeCount} 个节点、${edgeCount} 条连线`;
  const warnings: string[] = [];
  if (droppedEdgeCount > 0) warnings.push(`${droppedEdgeCount} 条连线因端点缺失被丢弃`);
  if (degradedNodeCount > 0) warnings.push(`${degradedNodeCount} 个节点类型非法已降级为 process`);
  const suffix = warnings.length > 0 ? `（${warnings.join('；')}）` : '';
  return `${base}${suffix}。请确认预览后点击「应用到画布」。`;
}

// ---------------------------------------------------------------------------
// 5) 人在回路：resumeToken 透传
// ---------------------------------------------------------------------------

/**
 * 人在回路挂起时后端可能随 payload 下发 resumeToken（防重复提交），
 * aiClient 的 HumanConfirmPayload 类型未声明该扩展字段，这里做安全提取（截断到 128）。
 */
export function extractResumeToken(payload: HumanConfirmPayloadLike): string | undefined {
  const raw = (payload as { resumeToken?: unknown } | null | undefined)?.resumeToken;
  if (typeof raw !== 'string') return undefined;
  const token = raw.trim();
  if (token.length === 0) return undefined;
  return token.slice(0, 128);
}

/** 只关心 resumeToken 扩展字段的最小结构（与 aiClient.HumanConfirmPayload 兼容） */
export interface HumanConfirmPayloadLike {
  reason: string;
  issues: unknown[];
  candidates: unknown[];
  /** 挂起时后端可能下发的恢复令牌（ConfirmRequest.resumeToken 透传） */
  resumeToken?: unknown;
}
