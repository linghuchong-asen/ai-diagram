// 语图技术方案 - frontend/index.md「FlowDraft → X6 转换层」（确定性转换，模型只出语义，坐标/样式程序化生成）
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 1.3
// 纯函数、无副作用，不 import React / @antv/x6 运行时实例；输出为纯数据，可直接喂给 graph.fromJSON(...)。
// 边结构对齐既有画布约定（src/utils/hooks/useGraph.tsx createEdge）：
//   labels[].position = { distance: 0.5, offset: 0 }、connector = { name: 'normal' }。
// 容错原则：flowDraftToX6 对任意脏输入（缺 id / 非法 type / 悬空边 / 重复 id）做归一化与降级，绝不抛异常。

import {
  buildEdgeAttrs,
  buildNodeAttrs,
  getNodeConfig,
  resolveNodeType,
} from './node-type-config';
import { buildPorts, pickSourcePort, pickTargetPort } from './port-groups';
import type {
  FlowDraft,
  FlowEdge,
  FlowNode,
  NodeType,
  Point,
  RawFlowDraft,
  RawFlowEdge,
  RawFlowNode,
  VisualChange,
  X6CellJSON,
  X6CellLike,
  X6EdgeData,
  X6EdgeEndpoint,
  X6EdgeLabel,
  X6GraphData,
  X6GraphJSON,
  X6NodeData,
  X6NodeMeta,
} from './types';

/** 默认落点（未提供 positions 时按索引纵向排列的起点） */
export const DEFAULT_ORIGIN: Point = { x: 60, y: 60 };
/** 未提供 positions 时的纵向兜底间距 */
export const FALLBACK_GAP_Y = 110;

/** AI 生成节点的默认数据来源标记 */
export type CellOrigin = 'ai-generate' | 'ai-modify' | 'canvas';

export interface ToX6NodeOptions {
  /** 左上角坐标，缺省 DEFAULT_ORIGIN */
  pos?: Point;
  /** 视觉变更（modify patch 应用后的样式） */
  visual?: VisualChange;
  origin?: CellOrigin;
  zIndex?: number;
  /** 类型降级信息（由 flowDraftToX6 归一化时传入） */
  degraded?: boolean;
  rawType?: string;
}

export interface ToX6EdgeOptions {
  /** 源节点类型：决定出桩端口（start 仅 bottom） */
  sourceType: NodeType;
  /** 目标节点类型：决定入桩端口（end 仅 top） */
  targetType: NodeType;
  visual?: VisualChange;
  origin?: CellOrigin;
  zIndex?: number;
}

/** flowDraftToX6 的输入：既接受已校验的 FlowDraft，也接受网络层未校验的原始结构 */
export type FlowDraftLike = FlowDraft | RawFlowDraft;

/** 归一化后的单个节点（含降级信息），flowDraftToX6 内部与单测共用 */
export interface NormalizedNode extends FlowNode {
  degraded: boolean;
  rawType?: string;
}

/** 归一化后的单条边（已剔除悬空边与自环） */
export type NormalizedEdge = FlowEdge;

export interface NormalizeResult {
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
  /** 被丢弃的悬空边（source/target 引用不存在的节点），供 UI 提示 */
  droppedEdges: RawFlowEdge[];
  /** 类型发生降级的节点 id 列表，供 UI 提示 */
  degradedNodeIds: string[];
}

// ---------------------------------------------------------------------------
// 内部工具
// ---------------------------------------------------------------------------

function toStr(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// 归一化：RawFlowDraft → 合法 FlowDraft（降级而不抛错）
// ---------------------------------------------------------------------------

/**
 * 将任意脏输入归一化为合法 FlowDraft 结构：
 * - 缺失/非字符串 id → 生成 `ai-node-{i}` / `ai-edge-{i}`（重复 id 追加序号去重）
 * - 缺失 label → 空字符串
 * - 非法/缺失 type → resolveNodeType 降级为 process 并记录 degraded/rawType
 * - source/target 不存在或自环 → 丢弃该边并记入 droppedEdges
 */
export function normalizeFlowDraft(draft: FlowDraftLike | undefined | null): NormalizeResult {
  const rawNodes: RawFlowNode[] = Array.isArray(draft?.nodes) ? (draft?.nodes as RawFlowNode[]) : [];
  const rawEdges: RawFlowEdge[] = Array.isArray(draft?.edges) ? (draft?.edges as RawFlowEdge[]) : [];

  const nodes: NormalizedNode[] = [];
  const usedIds = new Set<string>();

  rawNodes.forEach((raw, i) => {
    const source = isPlainRecord(raw) ? raw : {};
    let id = toStr(source.id) ?? '';
    if (id.length === 0 || usedIds.has(id)) {
      id = uniqueId(`ai-node-${i}`, usedIds);
    } else {
      usedIds.add(id);
    }
    const resolved = resolveNodeType(source.type);
    nodes.push({
      id,
      label: toStr(source.label) ?? '',
      type: resolved.type,
      degraded: resolved.degraded,
      rawType: resolved.rawType,
    });
  });

  const idSet = new Set<string>(nodes.map((n) => n.id));
  const edges: NormalizedEdge[] = [];
  const droppedEdges: RawFlowEdge[] = [];
  const usedEdgeIds = new Set<string>();

  rawEdges.forEach((raw, i) => {
    const source = isPlainRecord(raw) ? raw : {};
    const sourceId = toStr(source.source) ?? '';
    const targetId = toStr(source.target) ?? '';
    if (!idSet.has(sourceId) || !idSet.has(targetId) || sourceId === targetId) {
      droppedEdges.push(raw);
      return;
    }
    let id = toStr(source.id) ?? '';
    if (id.length === 0 || usedEdgeIds.has(id)) {
      id = uniqueId(`ai-edge-${i}`, usedEdgeIds);
    } else {
      usedEdgeIds.add(id);
    }
    const edge: NormalizedEdge = { id, source: sourceId, target: targetId };
    const label = toStr(source.label);
    if (label !== undefined) edge.label = label;
    edges.push(edge);
  });

  return {
    nodes,
    edges,
    droppedEdges,
    degradedNodeIds: nodes.filter((n) => n.degraded).map((n) => n.id),
  };
}

function uniqueId(base: string, used: Set<string>): string {
  let id = base;
  let suffix = 1;
  while (used.has(id)) {
    id = `${base}-${suffix}`;
    suffix += 1;
  }
  used.add(id);
  return id;
}

// ---------------------------------------------------------------------------
// 单节点 / 单边转换
// ---------------------------------------------------------------------------

/**
 * FlowNode → X6 节点数据。形状/尺寸/配色/端口全部由类型配置程序化决定。
 */
export function toX6Node(node: FlowNode, options?: ToX6NodeOptions): X6NodeData {
  const config = getNodeConfig(node.type);
  const pos = options?.pos ?? DEFAULT_ORIGIN;
  const meta: X6NodeMeta = {
    nodeType: node.type,
    label: node.label,
    degraded: options?.degraded ?? false,
    origin: options?.origin ?? 'ai-generate',
  };
  if (options?.rawType !== undefined) meta.rawType = options.rawType;
  if (options?.visual) meta.visual = options.visual;

  const out: X6NodeData = {
    id: node.id,
    shape: config.shape,
    x: Math.round(pos.x),
    y: Math.round(pos.y),
    width: config.width,
    height: config.height,
    attrs: buildNodeAttrs(node.type, options?.visual),
    ports: buildPorts(node.type),
    data: meta,
  };
  if (config.markup) out.markup = config.markup;
  if (typeof options?.zIndex === 'number') out.zIndex = options.zIndex;
  return out;
}

function buildEdgeLabel(text: string): X6EdgeLabel {
  return {
    attrs: {
      label: { text, fill: '#595959', fontSize: 11 },
      rect: { fill: '#FFFFFF', stroke: 'none', rx: 3, ry: 3, refWidth: '140%', refHeight: '140%', refX: '-20%', refY: '-20%' },
    },
    // 对齐既有画布约定：position 用 { distance, offset } 对象而非数字
    position: { distance: 0.5, offset: 0 },
  };
}

/**
 * FlowEdge → X6 边数据。端口由两端节点类型推导（start 只能出 bottom、end 只能入 top）。
 */
export function toX6Edge(edge: FlowEdge, options: ToX6EdgeOptions): X6EdgeData {
  const sourcePort = pickSourcePort(options.sourceType);
  const targetPort = pickTargetPort(options.targetType);
  const source: X6EdgeEndpoint = { cell: edge.source };
  const target: X6EdgeEndpoint = { cell: edge.target };
  if (sourcePort) source.port = sourcePort;
  if (targetPort) target.port = targetPort;

  const out: X6EdgeData = {
    id: edge.id,
    shape: 'edge',
    source,
    target,
    attrs: buildEdgeAttrs(options.visual),
    connector: { name: 'normal' },
    zIndex: typeof options.zIndex === 'number' ? options.zIndex : 0,
    data: {
      origin: options.origin ?? 'ai-generate',
      ...(options.visual ? { visual: options.visual } : {}),
      ...(edge.label !== undefined ? { label: edge.label } : {}),
    },
  };
  if (edge.label !== undefined && edge.label.length > 0) {
    out.labels = [buildEdgeLabel(edge.label)];
  }
  return out;
}

// ---------------------------------------------------------------------------
// 整图转换
// ---------------------------------------------------------------------------

export interface FlowDraftToX6Options {
  /** 节点 id → 左上角坐标；缺省时按索引纵向排列（正式使用应传入 autoLayout 结果） */
  positions?: Record<string, Point>;
  /** 节点 id → 视觉变更（modify patch 场景） */
  visuals?: Record<string, VisualChange>;
  origin?: CellOrigin;
}

export interface FlowDraftToX6Result extends X6GraphData {
  /** 归一化明细：悬空边、降级节点，供 UI 提示，绝不静默丢弃 */
  droppedEdges: RawFlowEdge[];
  degradedNodeIds: string[];
}

/**
 * FlowDraft（或脏输入）→ 可 graph.fromJSON 的 X6 图数据。
 * 纯函数；同一输入 + 同一 positions 必得同一输出（确定性）。
 */
export function flowDraftToX6(
  draft: FlowDraftLike | undefined | null,
  options?: FlowDraftToX6Options,
): FlowDraftToX6Result {
  const normalized = normalizeFlowDraft(draft);
  const positions = options?.positions;
  const visuals = options?.visuals;
  const origin = options?.origin ?? 'ai-generate';

  const nodes: X6NodeData[] = normalized.nodes.map((node, index) => {
    const pos = positions?.[node.id] ?? {
      x: DEFAULT_ORIGIN.x,
      y: DEFAULT_ORIGIN.y + index * FALLBACK_GAP_Y,
    };
    const nodeOptions: ToX6NodeOptions = {
      pos,
      origin,
      degraded: node.degraded,
    };
    if (node.rawType !== undefined) nodeOptions.rawType = node.rawType;
    const visual = visuals?.[node.id];
    if (visual) nodeOptions.visual = visual;
    return toX6Node(node, nodeOptions);
  });

  const typeById = new Map<string, NodeType>();
  normalized.nodes.forEach((node) => typeById.set(node.id, node.type));

  const edges: X6EdgeData[] = normalized.edges.map((edge) => {
    const edgeOptions: ToX6EdgeOptions = {
      sourceType: typeById.get(edge.source) ?? 'process',
      targetType: typeById.get(edge.target) ?? 'process',
      origin,
    };
    return toX6Edge(edge, edgeOptions);
  });

  return { nodes, edges, droppedEdges: normalized.droppedEdges, degradedNodeIds: normalized.degradedNodeIds };
}

// ---------------------------------------------------------------------------
// 反向回读：X6 图 JSON → FlowDraft（画布快照 / 二次编辑）
// ---------------------------------------------------------------------------

/** 从 attrs.label.text 回读节点文字 */
function readAttrsLabel(cell: X6CellJSON): string | undefined {
  const labelAttrs = cell.attrs?.label;
  const text = labelAttrs?.text;
  return typeof text === 'string' ? text : undefined;
}

/** 从 labels[0].attrs.label.text 回读边文字 */
function readEdgeLabel(cell: X6CellJSON): string | undefined {
  const first = Array.isArray(cell.labels) ? cell.labels[0] : undefined;
  const text = first?.attrs?.label?.text;
  return typeof text === 'string' ? text : undefined;
}

/** 端点归一化：{ cell, port } 或纯字符串 → 节点 id */
function readEndpointCell(endpoint: X6CellJSON['source']): string | undefined {
  if (typeof endpoint === 'string') return endpoint;
  if (endpoint && typeof endpoint === 'object' && typeof endpoint.cell === 'string') {
    return endpoint.cell;
  }
  return undefined;
}

function asNodeMeta(data: X6CellJSON['data']): Partial<X6NodeMeta> {
  return isPlainRecord(data) ? (data as Partial<X6NodeMeta>) : {};
}

/** 单元数组归一化（X6CellLike → X6CellJSON，非数组安全返回空） */
function cellList(list: readonly X6CellLike[] | undefined | null): X6CellJSON[] {
  if (!Array.isArray(list)) return [];
  return list.map((cell) => cell as X6CellJSON);
}

/**
 * graph.toJSON() 结果 → FlowDraft。
 * 优先读 data.nodeType / data.label（AI 节点），回退 attrs.label.text（用户手绘节点）；
 * type 非法时同样走 resolveNodeType 降级，绝不抛异常。
 */
export function x6ToFlowDraft(json: X6GraphJSON | undefined | null): FlowDraft {
  const cells: X6CellJSON[] = Array.isArray(json?.cells)
    ? cellList(json?.cells)
    : [...cellList(json?.nodes), ...cellList(json?.edges)];

  const nodes: FlowNode[] = [];
  const edges: FlowEdge[] = [];
  const nodeIds = new Set<string>();

  // 先收节点（边需要引用校验）
  cells.forEach((cell, i) => {
    if (cell.shape === 'edge' || cell.source !== undefined || cell.target !== undefined) return;
    const meta = asNodeMeta(cell.data);
    const resolved = resolveNodeType(meta.nodeType ?? cell.shape);
    const id = typeof cell.id === 'string' && cell.id.length > 0 ? cell.id : `canvas-node-${i}`;
    nodeIds.add(id);
    nodes.push({
      id,
      label: typeof meta.label === 'string' ? meta.label : readAttrsLabel(cell) ?? '',
      type: resolved.type,
    });
  });

  cells.forEach((cell, i) => {
    if (!(cell.shape === 'edge' || cell.source !== undefined || cell.target !== undefined)) return;
    const source = readEndpointCell(cell.source);
    const target = readEndpointCell(cell.target);
    if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) return;
    const meta = asNodeMeta(cell.data) as { label?: unknown };
    const label = typeof meta.label === 'string' ? meta.label : readEdgeLabel(cell);
    const id = typeof cell.id === 'string' && cell.id.length > 0 ? cell.id : `canvas-edge-${i}`;
    const edge: FlowEdge = { id, source, target };
    if (label !== undefined && label.length > 0) edge.label = label;
    edges.push(edge);
  });

  return { nodes, edges };
}
