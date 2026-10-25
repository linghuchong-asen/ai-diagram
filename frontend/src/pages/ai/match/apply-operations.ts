// 语图技术方案 - frontend/index.md「增量修改：应用计划 + 选择性应用 + 人在回路确认」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 3.3
// 要点：
//   1. 先把 7 种 PatchOperation 编译成「可视化应用计划」ApplyPlan（每项含匹配等级/置信度/候选/明细文案）；
//   2. 再由 applyOperations 按计划执行，支持 selectedIndexes 选择性应用与 resolvedAmbiguous 歧义裁决；
//   3. 未匹配、歧义未裁决、引用缺失一律**不执行**并计入 residual 残差显式上报，绝不静默丢弃、绝不误删；
//   4. 新增/重定位节点复用布局层（place-new-node），既有节点坐标不因避让而被动改动；
//   5. 纯函数：返回全新 CanvasSnapshot，不修改入参。

import { placeNewNode } from '../layout/place-new-node';
import { normalizeLabel } from '../shared/label';
import { resolveNodeType } from '../transform/node-type-config';
import type {
  PatchEdgeTarget,
  PatchNodeTarget,
  PatchOpKind,
  PatchOperation,
  RelativePosition,
  VisualChange,
} from '../transform/types';
import type { CanvasSnapshot, MatchLevel, SnapshotEdge, SnapshotNode } from './match-level';
import { cloneSnapshot, snapshotToPlacedRefs } from './match-level';
import type { MatchResult } from './matcher';
import { findNodeIdsByLabel, matchEdge, matchNode } from './matcher';

/** 残差/跳过原因分类 */
export type SkipReason =
  | 'unselected' // 用户未勾选
  | 'unmatched' // 四级匹配后仍未命中
  | 'ambiguous' // 歧义且用户未裁决
  | 'duplicate' // 幂等：同名节点/同端点边已存在
  | 'invalid'; // op 结构不合法

export interface ApplyPlanItem {
  /** 与 operations 数组下标一致，作为 selectedIndexes / resolvedAmbiguous 的键 */
  index: number;
  op: PatchOperation;
  kind: PatchOpKind;
  /** 一行标题，如「修改节点「提交申请」」 */
  title: string;
  /** 变更明细，如「标签 → 提交审批；边框 dashed」 */
  detail: string;
  level: MatchLevel;
  confidence: number;
  ambiguous: boolean;
  /** 候选元素（歧义时供用户在面板中选择） */
  candidates: { id: string; label: string }[];
  /** 唯一命中或已裁决后的目标 id */
  matchedId?: string;
  /** 默认勾选：命中且非歧义默认执行；歧义/未匹配默认不执行 */
  defaultSelected: boolean;
  /** 是否无法执行（未匹配 / 歧义未裁决 / 结构非法） */
  blocked: boolean;
  /** blocked 时给出跳过分类：面板可直接展示，残差归因不再靠文案猜测 */
  skipReason?: SkipReason;
  reason: string;
}

export interface ApplyPlan {
  items: ApplyPlanItem[];
  /** 计划编译时使用的快照（只读引用，执行时会 clone） */
  snapshot: CanvasSnapshot;
  /** 默认勾选集合 */
  selectedIndexes: number[];
  /** 无法执行的项（需在面板中显著提示） */
  blockedIndexes: number[];
}

export interface ApplyOperationResult {
  index: number;
  kind: PatchOpKind;
  ok: boolean;
  level: MatchLevel;
  confidence: number;
  /** 实际作用的画布元素 id */
  targetId?: string;
  reason: string;
  skip?: SkipReason;
}

export interface ApplyReport {
  /** 应用后的新快照（入参未被修改） */
  snapshot: CanvasSnapshot;
  results: ApplyOperationResult[];
  appliedCount: number;
  skippedCount: number;
  /** 残差：未执行且需人工处理（unmatched / ambiguous / duplicate / invalid） */
  residual: ApplyOperationResult[];
}

export interface ApplyOperationsOptions {
  /** 勾选执行的项下标；缺省表示使用计划的 defaultSelected */
  selectedIndexes?: number[];
  /** 歧义裁决：项下标 → 用户选定的画布元素 id */
  resolvedAmbiguous?: Record<number, string>;
  /** 已编译好的计划（缺省则内部编译） */
  plan?: ApplyPlan;
}

// ---------------------------------------------------------------------------
// 文案与工具
// ---------------------------------------------------------------------------

const DIRECTION_TEXT: Record<string, string> = {
  top: '上方',
  bottom: '下方',
  left: '左侧',
  right: '右侧',
};

function visualText(visual?: VisualChange): string[] {
  if (!visual) return [];
  const parts: string[] = [];
  if (visual.fillColor) parts.push(`填充色 ${visual.fillColor}`);
  if (visual.borderStyle) parts.push(`边框 ${visual.borderStyle}`);
  if (typeof visual.borderWidth === 'number') parts.push(`边框宽 ${visual.borderWidth}`);
  if (visual.fontColor) parts.push(`字色 ${visual.fontColor}`);
  if (typeof visual.fontSize === 'number') parts.push(`字号 ${visual.fontSize}`);
  return parts;
}

function mergeVisual(base: VisualChange | undefined, patch?: VisualChange): VisualChange | undefined {
  if (!patch) return base;
  return { ...(base ?? {}), ...patch };
}

function nodeText(snapshot: CanvasSnapshot, id?: string): string {
  if (!id) return '（未匹配）';
  const node = snapshot.nodes.find((item) => item.id === id);
  return node ? `「${node.label}」` : `「${id}」`;
}

function relativeText(position?: RelativePosition): string {
  if (!position) return '未指定相对位置（按相连节点质心放置）';
  return `位于「${position.relativeTo?.label ?? '?'}」的${DIRECTION_TEXT[position.direction] ?? position.direction}`;
}

function newId(prefix: string, used: string[]): string {
  let i = 1;
  let id = `${prefix}-${i}`;
  while (used.indexOf(id) >= 0) {
    i += 1;
    id = `${prefix}-${i}`;
  }
  return id;
}

function findNode(snapshot: CanvasSnapshot, id?: string): SnapshotNode | undefined {
  if (!id) return undefined;
  return snapshot.nodes.find((node) => node.id === id);
}

function findEdge(snapshot: CanvasSnapshot, id?: string): SnapshotEdge | undefined {
  if (!id) return undefined;
  return snapshot.edges.find((edge) => edge.id === id);
}

// ---------------------------------------------------------------------------
// 匹配（含歧义裁决）
// ---------------------------------------------------------------------------

interface ResolvedMatch {
  id?: string;
  level: MatchLevel;
  confidence: number;
  reason: string;
  skip?: SkipReason;
}

function resolveMatch(
  match: MatchResult,
  resolvedId: string | undefined,
): ResolvedMatch {
  if (match.level !== 'none' && !match.ambiguous && match.id) {
    return { id: match.id, level: match.level, confidence: match.confidence, reason: match.reason };
  }
  if (match.ambiguous) {
    if (resolvedId && match.candidates.indexOf(resolvedId) >= 0) {
      return {
        id: resolvedId,
        level: match.level,
        confidence: match.confidence,
        reason: `${match.reason}；已人工选定 ${resolvedId}`,
      };
    }
    return { level: match.level, confidence: match.confidence, reason: match.reason, skip: 'ambiguous' };
  }
  return { level: 'none', confidence: 0, reason: match.reason, skip: 'unmatched' };
}

function candidateLabels(
  snapshot: CanvasSnapshot,
  ids: string[],
  isEdge: boolean,
): { id: string; label: string }[] {
  return ids.map((id) => {
    if (isEdge) {
      const edge = snapshot.edges.find((item) => item.id === id);
      if (!edge) return { id, label: id };
      const sourceLabel = snapshot.nodes.find((n) => n.id === edge.source)?.label ?? edge.source;
      const targetLabel = snapshot.nodes.find((n) => n.id === edge.target)?.label ?? edge.target;
      return { id, label: `${sourceLabel} → ${targetLabel}${edge.label ? `（${edge.label}）` : ''}` };
    }
    const node = snapshot.nodes.find((item) => item.id === id);
    return { id, label: node ? `${node.label.trim()}（${node.type}）` : id };
  });
}

interface CompiledItem {
  plan: ApplyPlanItem;
}

function compileItem(
  index: number,
  op: PatchOperation,
  snapshot: CanvasSnapshot,
  resolvedAmbiguous?: Record<number, string>,
): CompiledItem {
  const base = {
    index,
    op,
    kind: op.op,
    candidates: [] as { id: string; label: string }[],
    defaultSelected: false,
    blocked: true,
  };
  const resolvedId = resolvedAmbiguous?.[index];

  switch (op.op) {
    case 'modify_node':
    case 'delete_node':
    case 'reposition': {
      const nodeTarget: PatchNodeTarget = op.target;
      const match = matchNode(nodeTarget, snapshot);
      const chosen = resolveMatch(match, resolvedId);
      const parts: string[] = [];
      if (op.op === 'modify_node') {
        if (op.semantic?.label) parts.push(`标签 → ${op.semantic.label}`);
        if (op.semantic?.nodeType) parts.push(`类型 → ${op.semantic.nodeType}`);
        parts.push(...visualText(op.visual));
      }
      if (op.op === 'reposition') parts.push(relativeText(op.position));
      const titleByKind: Record<string, string> = {
        modify_node: '修改节点',
        delete_node: '删除节点',
        reposition: '移动节点',
      };
      const detailByKind: Record<string, string> = {
        modify_node: parts.join('；') || '（无变更内容）',
        delete_node: '同时移除其相连的边',
        reposition: parts.join('；'),
      };
      const item: ApplyPlanItem = {
        ...base,
        title: `${titleByKind[op.op] ?? op.op} ${nodeText(snapshot, chosen.id ?? match.id)}`,
        detail: detailByKind[op.op] ?? '',
        level: chosen.level,
        confidence: chosen.confidence,
        ambiguous: match.ambiguous,
        candidates: candidateLabels(snapshot, match.candidates, false),
        blocked: chosen.skip !== undefined,
        ...(chosen.skip !== undefined ? { skipReason: chosen.skip } : {}),
        defaultSelected: chosen.skip === undefined,
        reason: chosen.reason,
      };
      if (chosen.id) item.matchedId = chosen.id;
      return { plan: item };
    }

    case 'modify_edge':
    case 'delete_edge': {
      const edgeTarget: PatchEdgeTarget = op.target;
      const match = matchEdge(edgeTarget, snapshot);
      const chosen = resolveMatch(match, resolvedId);
      const parts: string[] = [];
      if (op.op === 'modify_edge') {
        if (op.semantic?.label !== undefined) parts.push(`边标签 → ${op.semantic.label || '（清空）'}`);
        parts.push(...visualText(op.visual));
      }
      const item: ApplyPlanItem = {
        ...base,
        title: op.op === 'modify_edge' ? '修改边' : '删除边',
        detail:
          op.op === 'modify_edge'
            ? parts.join('；') || '（无变更内容）'
            : '仅移除该条边，不影响端点节点',
        level: chosen.level,
        confidence: chosen.confidence,
        ambiguous: match.ambiguous,
        candidates: candidateLabels(snapshot, match.candidates, true),
        blocked: chosen.skip !== undefined,
        ...(chosen.skip !== undefined ? { skipReason: chosen.skip } : {}),
        defaultSelected: chosen.skip === undefined,
        reason: chosen.reason,
      };
      if (chosen.id) item.matchedId = chosen.id;
      return { plan: item };
    }

    case 'add_node': {
      const label = typeof op.semantic?.label === 'string' ? op.semantic.label : '';
      const resolvedType = resolveNodeType(op.semantic?.nodeType);
      const duplicate = findNodeIdsByLabel(label, snapshot);
      const blocked = duplicate.length > 0 || label.length === 0;
      const item: ApplyPlanItem = {
        ...base,
        title: `新增节点「${label || '(空标签)'}」`,
        detail: [
          `类型 ${resolvedType.type}${resolvedType.degraded ? '（原始类型非法，已降级为 process）' : ''}`,
          relativeText(op.position),
        ].join('；'),
        level: blocked ? 'none' : 'L1',
        confidence: blocked ? 0 : 1,
        ambiguous: false,
        candidates: candidateLabels(snapshot, duplicate, false),
        blocked,
        ...(blocked ? { skipReason: (label.length === 0 ? 'invalid' : 'duplicate') as SkipReason } : {}),
        defaultSelected: !blocked,
        reason:
          label.length === 0
            ? '新增节点缺少 label'
            : duplicate.length > 0
              ? `画布已存在同名节点「${label}」，默认跳过（幂等）`
              : '新增元素，无需匹配画布',
      };
      return { plan: item };
    }

    case 'add_edge': {
      const sourceIds = findNodeIdsByLabel(op.semantic?.source, snapshot);
      const targetIds = findNodeIdsByLabel(op.semantic?.target, snapshot);
      const sourceOk = sourceIds.length === 1;
      const targetOk = targetIds.length === 1;
      const missing: string[] = [];
      if (!sourceOk) missing.push(`源「${op.semantic?.source ?? ''}」`);
      if (!targetOk) missing.push(`目标「${op.semantic?.target ?? ''}」`);
      // 端点唯一确定时再做幂等查重：画布已有同端点边则不重复新增
      const exists =
        sourceOk && targetOk
          ? snapshot.edges.some((edge) => edge.source === sourceIds[0] && edge.target === targetIds[0])
          : false;
      const blocked = missing.length > 0 || exists;
      const item: ApplyPlanItem = {
        ...base,
        title: `新增边 ${op.semantic?.source ?? ''} → ${op.semantic?.target ?? ''}`,
        detail: op.semantic?.label ? `边标签 ${op.semantic.label}` : '（无边标签）',
        level: blocked ? 'none' : 'L1',
        confidence: blocked ? 0 : 1,
        ambiguous: sourceIds.length > 1 || targetIds.length > 1,
        candidates: candidateLabels(snapshot, [...sourceIds, ...targetIds], false),
        blocked,
        ...(blocked
          ? { skipReason: (exists ? 'duplicate' : 'unmatched') as SkipReason }
          : {}),
        defaultSelected: !blocked,
        reason: exists
          ? `已存在 ${op.semantic?.source ?? ''} → ${op.semantic?.target ?? ''} 的边，默认跳过（幂等）`
          : blocked
            ? `端点无法唯一确定：${missing.join('、')}（可能由同批次新增节点提供）`
            : '端点唯一确定，可直接新增',
      };
      return { plan: item };
    }

    default: {
      const item: ApplyPlanItem = {
        ...base,
        title: '未知操作',
        detail: '后端返回了不支持的 op 类型',
        level: 'none',
        confidence: 0,
        ambiguous: false,
        candidates: [],
        blocked: true,
        skipReason: 'invalid',
        defaultSelected: false,
        reason: '未知 op 类型，已忽略',
      };
      return { plan: item };
    }
  }
}

/**
 * 从同批次 add_edge 操作推导新节点的相连节点 id（用于质心兜底定位）。
 * createdLabels：本轮已新建节点的「归一化 label → id」，使「先增节点后连边」的顺序也能算出质心。
 */
function collectNeighborIds(
  label: string,
  operations: readonly PatchOperation[],
  snapshot: CanvasSnapshot,
  createdLabels: Map<string, string>,
): string[] {
  const wanted = normalizeLabel(label);
  if (wanted.length === 0) return [];
  const ids: string[] = [];
  operations.forEach((op) => {
    if (op.op !== 'add_edge') return;
    const src = normalizeLabel(op.semantic?.source);
    const tgt = normalizeLabel(op.semantic?.target);
    let other: string | undefined;
    if (src === wanted && tgt.length > 0) other = tgt;
    else if (tgt === wanted && src.length > 0) other = src;
    if (!other) return;
    const createdId = createdLabels.get(other);
    if (createdId) {
      ids.push(createdId);
      return;
    }
    const hits = findNodeIdsByLabel(other, snapshot);
    if (hits.length === 1 && hits[0]) ids.push(hits[0]);
  });
  return Array.from(new Set(ids));
}

/**
 * 在工作快照上执行单条已编译操作（就地修改工作副本；不触碰调用方原快照）。
 */
function executeItem(
  working: CanvasSnapshot,
  compiled: CompiledItem,
  operations: readonly PatchOperation[],
  createdLabels: Map<string, string>,
): ApplyOperationResult {
  const { plan } = compiled;
  const op = plan.op;
  const index = plan.index;
  const fail = (skip: SkipReason, reason: string): ApplyOperationResult => ({
    index,
    kind: plan.kind,
    ok: false,
    level: plan.level,
    confidence: plan.confidence,
    reason,
    skip,
  });
  const ok = (targetId: string | undefined, reason: string): ApplyOperationResult => ({
    index,
    kind: plan.kind,
    ok: true,
    level: plan.level,
    confidence: plan.confidence,
    reason,
    ...(targetId ? { targetId } : {}),
  });

  switch (op.op) {
    case 'modify_node': {
      const node = findNode(working, plan.matchedId);
      if (!node) return fail('invalid', plan.reason);
      if (op.semantic?.label !== undefined) node.label = op.semantic.label;
      if (op.semantic?.nodeType !== undefined) node.type = resolveNodeType(op.semantic.nodeType).type;
      node.visual = mergeVisual(node.visual, op.visual);
      createdLabels.set(normalizeLabel(node.label), node.id);
      return ok(node.id, plan.reason);
    }

    case 'delete_node': {
      const node = findNode(working, plan.matchedId);
      if (!node) return fail('invalid', plan.reason);
      const incident = working.edges.filter((edge) => edge.source === node.id || edge.target === node.id);
      working.nodes = working.nodes.filter((item) => item.id !== node.id);
      working.edges = working.edges.filter((edge) => edge.source !== node.id && edge.target !== node.id);
      return ok(node.id, `已删除节点「${node.label}」及其 ${incident.length} 条相连边`);
    }

    case 'modify_edge': {
      const edge = findEdge(working, plan.matchedId);
      if (!edge) return fail('invalid', plan.reason);
      if (op.semantic?.label !== undefined) {
        if (op.semantic.label.length > 0) edge.label = op.semantic.label;
        else delete edge.label;
      }
      edge.visual = mergeVisual(edge.visual, op.visual);
      return ok(edge.id, plan.reason);
    }

    case 'delete_edge': {
      const edge = findEdge(working, plan.matchedId);
      if (!edge) return fail('invalid', plan.reason);
      working.edges = working.edges.filter((item) => item.id !== edge.id);
      return ok(edge.id, '已删除该边（端点节点保留）');
    }

    case 'add_node': {
      const label = op.semantic?.label ?? '';
      if (label.length === 0) return fail('invalid', '新增节点缺少 label');
      if (findNodeIdsByLabel(label, working).length > 0) {
        return fail('duplicate', `画布已存在同名节点「${label}」，已跳过（幂等）`);
      }
      const resolved = resolveNodeType(op.semantic?.nodeType);
      const neighborIds = collectNeighborIds(label, operations, working, createdLabels);
      const placed = placeNewNode({
        type: resolved.type,
        label,
        ...(op.position ? { position: op.position } : {}),
        ...(neighborIds.length > 0 ? { neighborIds } : {}),
        existing: snapshotToPlacedRefs(working),
      });
      const id = newId('ai-node', working.nodes.map((node) => node.id));
      const node: SnapshotNode = {
        id,
        label,
        type: resolved.type,
        x: placed.point.x,
        y: placed.point.y,
        width: placed.rect.width,
        height: placed.rect.height,
      };
      working.nodes = [...working.nodes, node];
      createdLabels.set(normalizeLabel(label), id);
      return ok(
        id,
        `已新增节点「${label}」于 (${placed.point.x}, ${placed.point.y})，定位：${placed.strategy}${
          placed.shifted ? '（已碰撞避让）' : ''
        }`,
      );
    }

    case 'add_edge': {
      const sourceIds = findNodeIdsByLabel(op.semantic?.source, working);
      const targetIds = findNodeIdsByLabel(op.semantic?.target, working);
      const sourceId = sourceIds.length === 1 ? sourceIds[0] : undefined;
      const targetId = targetIds.length === 1 ? targetIds[0] : undefined;
      if (!sourceId || !targetId) {
        return fail(
          'unmatched',
          `端点无法唯一确定：源候选 ${sourceIds.length} 个、目标候选 ${targetIds.length} 个`,
        );
      }
      const exists = working.edges.some((edge) => edge.source === sourceId && edge.target === targetId);
      if (exists) {
        return fail('duplicate', `已存在 ${op.semantic?.source} → ${op.semantic?.target} 的边，已跳过（幂等）`);
      }
      const id = newId('ai-edge', working.edges.map((edge) => edge.id));
      const edge: SnapshotEdge = { id, source: sourceId, target: targetId };
      if (op.semantic?.label) edge.label = op.semantic.label;
      working.edges = [...working.edges, edge];
      return ok(id, `已新增边 ${op.semantic?.source} → ${op.semantic?.target}`);
    }

    case 'reposition': {
      const node = findNode(working, plan.matchedId);
      if (!node) return fail('invalid', plan.reason);
      const others = working.nodes.filter((item) => item.id !== node.id);
      const neighborIds = others
        .filter((other) =>
          working.edges.some(
            (edge) =>
              (edge.source === node.id && edge.target === other.id) ||
              (edge.target === node.id && edge.source === other.id),
          ),
        )
        .map((other) => other.id);
      const placed = placeNewNode({
        type: node.type,
        label: node.label,
        ...(op.position ? { position: op.position } : {}),
        ...(neighborIds.length > 0 ? { neighborIds } : {}),
        existing: snapshotToPlacedRefs({ nodes: others, edges: working.edges }),
      });
      node.x = placed.point.x;
      node.y = placed.point.y;
      return ok(node.id, `已移动节点「${node.label}」至 (${placed.point.x}, ${placed.point.y})，定位：${placed.strategy}`);
    }

    default:
      return fail('invalid', '未知 op 类型');
  }
}

/**
 * 编译应用计划：只读分析调用方快照；内部用「滚动工作副本」顺序编译，
 * 使 add_node 之后的 add_edge / reposition 也能解析到本批次新增的节点。
 */
export function buildApplyPlan(
  operations: readonly PatchOperation[] | undefined | null,
  snapshot: CanvasSnapshot,
  resolvedAmbiguous?: Record<number, string>,
): ApplyPlan {
  const list = Array.isArray(operations) ? operations : [];
  const rolling = cloneSnapshot(snapshot);
  const createdLabels = new Map<string, string>();
  const items: ApplyPlanItem[] = [];

  list.forEach((op, index) => {
    const compiled = compileItem(index, op, rolling, resolvedAmbiguous);
    items.push(compiled.plan);
    if (compiled.plan.defaultSelected) {
      executeItem(rolling, compiled, list, createdLabels);
    }
  });

  return {
    items,
    snapshot,
    selectedIndexes: items.filter((item) => item.defaultSelected).map((item) => item.index),
    blockedIndexes: items.filter((item) => item.blocked).map((item) => item.index),
  };
}

/**
 * 按计划应用操作。selectedIndexes 缺省时使用计划默认勾选项；
 * 未勾选项不执行（skip='unselected'）；无法执行项计入 residual 显式上报。
 */
export function applyOperations(
  snapshot: CanvasSnapshot,
  operations: readonly PatchOperation[] | undefined | null,
  options?: ApplyOperationsOptions,
): ApplyReport {
  const list = Array.isArray(operations) ? operations : [];
  const plan = options?.plan ?? buildApplyPlan(list, snapshot, options?.resolvedAmbiguous);
  const selected = new Set(
    options?.selectedIndexes ?? plan.items.filter((item) => item.defaultSelected).map((item) => item.index),
  );

  const working = cloneSnapshot(snapshot);
  const createdLabels = new Map<string, string>();
  const results: ApplyOperationResult[] = [];

  plan.items.forEach((item) => {
    const op = list[item.index];
    if (!op) {
      results.push({
        index: item.index,
        kind: item.kind,
        ok: false,
        level: 'none',
        confidence: 0,
        reason: '操作缺失（下标越界）',
        skip: 'invalid',
      });
      return;
    }
    // 基于当前工作快照重新编译：前序操作可能已新增/删除元素，需重新裁决
    const compiled = compileItem(item.index, op, working, options?.resolvedAmbiguous);
    // 无法执行的项优先按真实原因上报（即使未被勾选，也必须进残差显式告知）
    if (compiled.plan.blocked) {
      results.push({
        index: item.index,
        kind: item.kind,
        ok: false,
        level: compiled.plan.level,
        confidence: compiled.plan.confidence,
        reason: compiled.plan.reason,
        skip: compiled.plan.skipReason ?? 'invalid',
      });
      return;
    }
    if (!selected.has(item.index)) {
      results.push({
        index: item.index,
        kind: item.kind,
        ok: false,
        level: item.level,
        confidence: item.confidence,
        reason: '用户未勾选，已跳过',
        skip: 'unselected',
      });
      return;
    }
    results.push(executeItem(working, compiled, list, createdLabels));
  });

  return {
    snapshot: working,
    results,
    appliedCount: results.filter((result) => result.ok).length,
    skippedCount: results.filter((result) => !result.ok).length,
    residual: results.filter((result) => !result.ok && result.skip !== 'unselected'),
  };
}
