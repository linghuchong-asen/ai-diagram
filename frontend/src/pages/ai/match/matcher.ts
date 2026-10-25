// 语图技术方案 - frontend/index.md「四级降级匹配：L1 id → L2 语义 → L3 拓扑 → L4 兜底」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 3.2
// 存在原因：后端 patch 用 oldLabel/label 定位、不带 id（见 serverend/src/ai/schemas/patch.schema.ts），
//   因此前端必须自行把「语义描述」映射回画布真实元素；同时兼容带 id/oldId 的情况（走 L1）。
// 约束：未匹配结果一律返回 level='none' 并作为残差显式上报，绝不静默丢弃、绝不猜测删除。
// 纯函数、无副作用：只读 CanvasSnapshot，返回新对象。

import { normalizeLabel } from '../shared/label';
import type { NodeType, PatchEdgeTarget, PatchNodeTarget } from '../transform/types';
import type { CanvasSnapshot, MatchLevel, SnapshotNode } from './match-level';
import { MATCH_LEVEL_LABEL, confidenceFor } from './match-level';

/** L3 拓扑签名相似度达到该阈值才算「命中拓扑」，否则降到 L4 兜底 */
export const TOPOLOGY_MATCH_THRESHOLD = 0.5;

export interface MatchResult {
  level: MatchLevel;
  /** 由 level + 是否歧义推导（L1=1.0 / L2=0.9|0.5 / L3=0.75|0.4 / L4=0.3 / none=0） */
  confidence: number;
  /** 唯一命中时的画布元素 id */
  id?: string;
  /** 候选 id 列表：唯一命中长度为 1；歧义时 >1；未匹配为空 */
  candidates: string[];
  /** 是否歧义（需人工在 ApplyPlanPanel 中选择） */
  ambiguous: boolean;
  /** 中文原因说明，直接展示给用户 */
  reason: string;
}

export function noneMatch(reason: string): MatchResult {
  return { level: 'none', confidence: confidenceFor('none'), candidates: [], ambiguous: false, reason };
}

function build(level: MatchLevel, candidates: string[], reason: string, ambiguous?: boolean): MatchResult {
  const isAmbiguous = ambiguous ?? candidates.length > 1;
  const result: MatchResult = {
    level,
    confidence: confidenceFor(level, isAmbiguous),
    candidates: [...candidates],
    ambiguous: isAmbiguous,
    reason: `${MATCH_LEVEL_LABEL[level]}：${reason}`,
  };
  if (!isAmbiguous && candidates.length === 1) result.id = candidates[0];
  return result;
}

// ---------------------------------------------------------------------------
// 基础检索
// ---------------------------------------------------------------------------

function targetLabel(target: { oldLabel?: string; label?: string }): string {
  return normalizeLabel(target.oldLabel ?? target.label);
}

/** 按归一化 label 找节点 id 列表（可能多个 → 歧义） */
export function findNodeIdsByLabel(label: unknown, snapshot: CanvasSnapshot): string[] {
  const wanted = normalizeLabel(label);
  if (wanted.length === 0) return [];
  return snapshot.nodes.filter((node) => normalizeLabel(node.label) === wanted).map((node) => node.id);
}

/** 按 id 找节点（L1） */
export function findNodeById(id: unknown, snapshot: CanvasSnapshot): SnapshotNode | undefined {
  if (typeof id !== 'string' || id.length === 0) return undefined;
  return snapshot.nodes.find((node) => node.id === id);
}

export interface NodeMatchHint {
  /** 期望语义类型（可选）：L2 命中多个时用于消歧 */
  type?: NodeType;
  /** 期望前驱节点 label（可选，L3 拓扑签名） */
  predecessors?: string[];
  /** 期望后继节点 label（可选，L3 拓扑签名） */
  successors?: string[];
}

export interface TopologySignature {
  preds: string[];
  succs: string[];
}

/** 画布上某节点的前驱/后继「label 集合」（与 hint 同构，便于比较） */
export function topologySignature(nodeId: string, snapshot: CanvasSnapshot): TopologySignature {
  const labelOf = (id: string): string => {
    const found = snapshot.nodes.find((node) => node.id === id);
    return normalizeLabel(found?.label);
  };
  const preds: string[] = [];
  const succs: string[] = [];
  snapshot.edges.forEach((edge) => {
    if (edge.target === nodeId) preds.push(labelOf(edge.source));
    if (edge.source === nodeId) succs.push(labelOf(edge.target));
  });
  return { preds, succs };
}

function multisetSimilarity(expected: string[], actual: string[]): { matched: number; total: number } {
  const pool = actual.filter((v) => v.length > 0);
  let matched = 0;
  expected.forEach((want) => {
    const key = normalizeLabel(want);
    if (key.length === 0) return;
    const index = pool.indexOf(key);
    if (index >= 0) {
      matched += 1;
      pool.splice(index, 1);
    }
  });
  return { matched, total: expected.length };
}

/** 拓扑签名相似度 0~1（前驱 + 后继合并统计；无期望信息时为 0） */
export function signatureSimilarity(expected: TopologySignature, actual: TopologySignature): number {
  const pred = multisetSimilarity(expected.preds, actual.preds);
  const succ = multisetSimilarity(expected.succs, actual.succs);
  const total = pred.total + succ.total;
  if (total === 0) return 0;
  return (pred.matched + succ.matched) / total;
}

// ---------------------------------------------------------------------------
// L2 / L3 / L4：节点
// ---------------------------------------------------------------------------

/** 期望类型的节点集合（用于 L2 消歧） */
function filterByType(ids: string[], snapshot: CanvasSnapshot, type?: NodeType): string[] {
  if (!type) return ids;
  const typed = ids.filter((id) => snapshot.nodes.find((node) => node.id === id)?.type === type);
  return typed.length > 0 ? typed : ids;
}

/**
 * 节点四级降级匹配：
 *   L1：target.id / target.oldId 命中画布节点 id
 *   L2：oldLabel 归一化后命中 label（多候选时按 hint.type 消歧，仍多则 ambiguous=0.5）
 *   L3：hint 前驱/后继签名相似度 ≥ 阈值（唯一 0.75 / 多个 0.4）
 *   L4：仅部分命中（label 包含关系或签名相似度 >0）→ 0.3，必须人工确认
 */
export function matchNode(
  target: PatchNodeTarget | undefined | null,
  snapshot: CanvasSnapshot,
  hint?: NodeMatchHint,
): MatchResult {
  if (!target) return noneMatch('缺少定位目标');
  if (snapshot.nodes.length === 0) return noneMatch('画布为空');

  // L1
  const byId = findNodeById(target.id ?? target.oldId, snapshot);
  if (byId) return build('L1', [byId.id], `id=${byId.id} 精确命中`);

  const wanted = targetLabel(target);

  // L2
  if (wanted.length > 0) {
    let hits = findNodeIdsByLabel(wanted, snapshot);
    if (hits.length > 1 && hint?.type) hits = filterByType(hits, snapshot, hint.type);
    if (hits.length === 1) return build('L2', hits, `标签「${wanted}」唯一命中`);
    if (hits.length > 1) {
      return build('L2', hits, `标签「${wanted}」命中 ${hits.length} 个节点，需人工确认`, true);
    }
  }

  // L3
  const expectedSig: TopologySignature = {
    preds: (hint?.predecessors ?? []).map(normalizeLabel),
    succs: (hint?.successors ?? []).map(normalizeLabel),
  };
  const hasSig = expectedSig.preds.length + expectedSig.succs.length > 0;
  if (hasSig) {
    const scored = snapshot.nodes.map((node) => ({
      id: node.id,
      score: signatureSimilarity(expectedSig, topologySignature(node.id, snapshot)),
    }));
    const best = scored.reduce((max, item) => (item.score > max.score ? item : max), { id: '', score: 0 });
    const qualified = scored.filter((item) => item.score >= TOPOLOGY_MATCH_THRESHOLD);
    if (qualified.length === 1 && qualified[0]) {
      return build('L3', [qualified[0].id], `前后继签名相似度 ${qualified[0].score.toFixed(2)}`);
    }
    if (qualified.length > 1) {
      return build(
        'L3',
        qualified.map((item) => item.id),
        `前后继签名相似度并列 ${qualified.length} 个节点，需人工确认`,
        true,
      );
    }
    // L4：签名有部分命中但不足阈值
    if (best.score > 0) {
      return build('L4', [best.id], `仅部分拓扑命中（相似度 ${best.score.toFixed(2)}），需人工确认`, false);
    }
  }

  // L4：标签部分命中（包含关系），供人工确认
  if (wanted.length > 0) {
    const partial = snapshot.nodes
      .map((node) => {
        const label = normalizeLabel(node.label);
        if (label.length === 0) return undefined;
        return label.indexOf(wanted) >= 0 || wanted.indexOf(label) >= 0 ? node.id : undefined;
      })
      .filter((id): id is string => typeof id === 'string');
    if (partial.length > 0) {
      return build('L4', partial, `标签部分命中 ${partial.length} 个节点，需人工确认`, true);
    }
  }

  return noneMatch(
    wanted.length > 0 ? `画布中找不到标签为「${wanted}」的节点` : '定位目标缺少 id 与 oldLabel',
  );
}

// ---------------------------------------------------------------------------
// 边
// ---------------------------------------------------------------------------

function endpointCandidates(endpointLabel: string | undefined, snapshot: CanvasSnapshot): string[] {
  if (!endpointLabel) return [];
  return findNodeIdsByLabel(endpointLabel, snapshot);
}

/**
 * 边四级降级匹配：
 *   L1：target.id / target.oldId 命中画布边 id
 *   L2：边自身 label（oldLabel/label）归一化命中（唯一 0.9 / 多个 0.5）
 *   L3：source/target 端点标签解析为节点后，唯一确定一条边（0.75 / 多条 0.4）
 *   L4：仅单端命中，或端点解析歧义 → 0.3，必须人工确认
 */
export function matchEdge(
  target: PatchEdgeTarget | undefined | null,
  snapshot: CanvasSnapshot,
): MatchResult {
  if (!target) return noneMatch('缺少边定位目标');
  if (snapshot.edges.length === 0) return noneMatch('画布无边');

  // L1
  const wantedId = target.id ?? target.oldId;
  if (typeof wantedId === 'string' && wantedId.length > 0) {
    const hit = snapshot.edges.find((edge) => edge.id === wantedId);
    if (hit) return build('L1', [hit.id], `id=${hit.id} 精确命中`);
  }

  // L2：边自身标签
  const wantedLabel = targetLabel(target);
  if (wantedLabel.length > 0) {
    const hits = snapshot.edges
      .filter((edge) => normalizeLabel(edge.label) === wantedLabel)
      .map((edge) => edge.id);
    if (hits.length === 1) return build('L2', hits, `边标签「${wantedLabel}」唯一命中`);
    if (hits.length > 1) {
      return build('L2', hits, `边标签「${wantedLabel}」命中 ${hits.length} 条边，需人工确认`, true);
    }
  }

  // L3：端点标签 → 节点 id → 唯一边
  const sourceIds = endpointCandidates(target.source, snapshot);
  const targetIds = endpointCandidates(target.target, snapshot);
  if (sourceIds.length > 0 && targetIds.length > 0) {
    const sourceSet = new Set(sourceIds);
    const targetSet = new Set(targetIds);
    const hits = snapshot.edges
      .filter((edge) => sourceSet.has(edge.source) && targetSet.has(edge.target))
      .map((edge) => edge.id);
    if (hits.length === 1) {
      return build('L3', hits, `端点「${target.source}→${target.target}」唯一确定一条边`);
    }
    if (hits.length > 1) {
      return build('L3', hits, `端点「${target.source}→${target.target}」命中 ${hits.length} 条边，需人工确认`, true);
    }
  }

  // L4：仅单端命中（另一端标签对不上或画布尚无该边）
  if (sourceIds.length > 0 || targetIds.length > 0) {
    const known = sourceIds.length > 0 ? sourceIds : targetIds;
    const bySource = sourceIds.length > 0;
    const hits = snapshot.edges
      .filter((edge) => (bySource ? known.indexOf(edge.source) >= 0 : known.indexOf(edge.target) >= 0))
      .map((edge) => edge.id);
    if (hits.length > 0) {
      return build(
        'L4',
        hits,
        `仅单端命中 ${hits.length} 条边（${bySource ? '源' : '目标'}端），需人工确认`,
        true,
      );
    }
    return build('L4', [], '仅端点标签部分命中，画布上无对应边，需人工确认', false);
  }

  return noneMatch('画布中找不到与该边标签或端点匹配的边');
}
