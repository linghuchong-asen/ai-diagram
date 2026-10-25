// 语图技术方案 - frontend/index.md「四级降级匹配：等级定义与置信度」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 3.1
// 要点：
//   L1 id 精确匹配（patch.target 带 id/oldId 时）           置信度 1.0
//   L2 语义匹配（label + nodeType 归一化比较）               唯一 0.9 / 多候选 0.5
//   L3 拓扑匹配（前驱/后继签名）                             唯一 0.75 / 多候选 0.4
//   L4 边校验兜底（部分端点命中，必须人工确认）               0.3
//   none 未匹配 → 作为「残差」显式列出，绝不静默丢弃
// 同时定义 CanvasSnapshot：匹配层只消费「画布语义快照」，与 X6 运行时解耦。

import { getNodeSize, resolveNodeType } from '../transform/node-type-config';
import type {
  NodeType,
  VisualChange,
  X6CellJSON,
  X6GraphJSON,
} from '../transform/types';

export const MATCH_LEVELS = ['L1', 'L2', 'L3', 'L4', 'none'] as const;
export type MatchLevel = (typeof MATCH_LEVELS)[number];

export const MATCH_CONFIDENCE = {
  L1: 1.0,
  L2_UNIQUE: 0.9,
  L2_AMBIGUOUS: 0.5,
  L3_UNIQUE: 0.75,
  L3_AMBIGUOUS: 0.4,
  L4: 0.3,
  NONE: 0,
} as const;

export const MATCH_LEVEL_LABEL: Record<MatchLevel, string> = {
  L1: 'ID 精确匹配',
  L2: '语义匹配（标签/类型）',
  L3: '拓扑匹配（前后继签名）',
  L4: '边校验兜底',
  none: '未匹配（残差）',
};

/** 由等级 + 是否歧义推导置信度 */
export function confidenceFor(level: MatchLevel, ambiguous: boolean = false): number {
  switch (level) {
    case 'L1':
      return MATCH_CONFIDENCE.L1;
    case 'L2':
      return ambiguous ? MATCH_CONFIDENCE.L2_AMBIGUOUS : MATCH_CONFIDENCE.L2_UNIQUE;
    case 'L3':
      return ambiguous ? MATCH_CONFIDENCE.L3_AMBIGUOUS : MATCH_CONFIDENCE.L3_UNIQUE;
    case 'L4':
      return MATCH_CONFIDENCE.L4;
    case 'none':
    default:
      return MATCH_CONFIDENCE.NONE;
  }
}

// ---------------------------------------------------------------------------
// 画布语义快照
// ---------------------------------------------------------------------------

export interface SnapshotNode {
  id: string;
  label: string;
  type: NodeType;
  x: number;
  y: number;
  width: number;
  height: number;
  visual?: VisualChange;
}

export interface SnapshotEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  visual?: VisualChange;
}

export interface CanvasSnapshot {
  nodes: SnapshotNode[];
  edges: SnapshotEdge[];
}

export function emptySnapshot(): CanvasSnapshot {
  return { nodes: [], edges: [] };
}

/** 深拷贝快照（应用操作时不修改调用方持有的原对象） */
export function cloneSnapshot(snapshot: CanvasSnapshot | undefined | null): CanvasSnapshot {
  if (!snapshot) return emptySnapshot();
  return {
    nodes: snapshot.nodes.map((node) => ({ ...node })),
    edges: snapshot.edges.map((edge) => ({ ...edge })),
  };
}

/**
 * graph.toJSON() → CanvasSnapshot。
 * 坐标/尺寸优先取 cell 上的 x/y/width/height，缺失时按类型尺寸推算；
 * label/type 优先读 data 元信息，回退 attrs.label.text；type 非法走降级（degraded 不在此层暴露）。
 */
export function snapshotFromGraphJSON(json: X6GraphJSON | undefined | null): CanvasSnapshot {
  const cells: X6CellJSON[] = Array.isArray(json?.cells)
    ? (json?.cells as X6CellJSON[])
    : [
        ...(Array.isArray(json?.nodes) ? (json?.nodes as X6CellJSON[]) : []),
        ...(Array.isArray(json?.edges) ? (json?.edges as X6CellJSON[]) : []),
      ];

  const snapshot = emptySnapshot();
  const nodeIds = new Set<string>();

  cells.forEach((cell, i) => {
    const isEdge = cell.shape === 'edge' || cell.source !== undefined || cell.target !== undefined;
    if (isEdge) return;
    const data = (cell.data ?? {}) as { label?: unknown; nodeType?: unknown; visual?: unknown };
    const id = typeof cell.id === 'string' && cell.id.length > 0 ? cell.id : `canvas-node-${i}`;
    const resolved = resolveNodeType(data.nodeType ?? cell.shape);
    const size = getNodeSize(resolved.type);
    const textAttr = cell.attrs?.label?.text;
    const node: SnapshotNode = {
      id,
      label: typeof data.label === 'string' ? data.label : typeof textAttr === 'string' ? textAttr : '',
      type: resolved.type,
      x: typeof cell.x === 'number' ? cell.x : 60,
      y: typeof cell.y === 'number' ? cell.y : 60,
      width: typeof cell.width === 'number' ? cell.width : size.width,
      height: typeof cell.height === 'number' ? cell.height : size.height,
    };
    if (data.visual && typeof data.visual === 'object') node.visual = data.visual as VisualChange;
    nodeIds.add(id);
    snapshot.nodes.push(node);
  });

  cells.forEach((cell, i) => {
    const isEdge = cell.shape === 'edge' || cell.source !== undefined || cell.target !== undefined;
    if (!isEdge) return;
    const source = readEndpoint(cell.source);
    const target = readEndpoint(cell.target);
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return;
    const data = (cell.data ?? {}) as { label?: unknown; visual?: unknown };
    const firstLabel = Array.isArray(cell.labels) ? cell.labels[0] : undefined;
    const labelText = firstLabel?.attrs?.label?.text;
    const edge: SnapshotEdge = {
      id: typeof cell.id === 'string' && cell.id.length > 0 ? cell.id : `canvas-edge-${i}`,
      source,
      target,
    };
    const label = typeof data.label === 'string' ? data.label : typeof labelText === 'string' ? labelText : undefined;
    if (label !== undefined && label.length > 0) edge.label = label;
    if (data.visual && typeof data.visual === 'object') edge.visual = data.visual as VisualChange;
    snapshot.edges.push(edge);
  });

  return snapshot;
}

function readEndpoint(endpoint: X6CellJSON['source']): string | undefined {
  if (typeof endpoint === 'string') return endpoint;
  if (endpoint && typeof endpoint === 'object' && typeof endpoint.cell === 'string') return endpoint.cell;
  return undefined;
}

/** 快照 → PlacedNodeRef[]（供布局层碰撞检测复用） */
export function snapshotToPlacedRefs(snapshot: CanvasSnapshot) {
  return snapshot.nodes.map((node) => ({
    id: node.id,
    label: node.label,
    type: node.type,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
  }));
}
