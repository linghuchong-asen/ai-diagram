// 语图技术方案 - 前端 AI 模块共享契约类型（frontend/index.md「FlowDraft 到 X6 转换层」）
// 与后端 serverend/src/ai/schemas/{node,flow-draft,patch}.schema.ts 一一对齐：
//   NODE_TYPES / FlowNode / FlowEdge / FlowDraft / VisualChange / Position / PatchOperation(7 种 op)
// 前端不引入 zod，仅以 TypeScript 类型镜像契约；另补充「未校验原始输入」与「X6 图数据」两组结构类型。
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 1.1~1.3（被 Task 2 / Task 3 复用）。

// ---------------------------------------------------------------------------
// 1) 节点类型契约（对齐后端 node.schema.ts）
// ---------------------------------------------------------------------------

export const NODE_TYPES = [
  'start',
  'end',
  'process',
  'decision',
  'io',
  'subprocess',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

/** 后端 FlowNode：语义结构，无坐标、无样式、无 ports */
export interface FlowNode {
  id: string;
  label: string;
  type: NodeType;
}

/** 后端 CanvasNode：画布语义摘要（带 ID，用于 modify 场景定位） */
export interface CanvasNode {
  id: string;
  label: string;
  type: NodeType;
}

/** 后端 FlowEdge / FlowDraft（flow-draft.schema.ts） */
export interface FlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface FlowDraft {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

// ---------------------------------------------------------------------------
// 2) 未经校验的网络层原始输入（type 可能缺失/非法，id 可能重复或缺失）
//    转换层必须对其做降级处理，绝不抛异常中断整图渲染
// ---------------------------------------------------------------------------

export interface RawFlowNode {
  id?: unknown;
  label?: unknown;
  type?: unknown;
  [key: string]: unknown;
}

export interface RawFlowEdge {
  id?: unknown;
  source?: unknown;
  target?: unknown;
  label?: unknown;
  [key: string]: unknown;
}

export interface RawFlowDraft {
  nodes?: RawFlowNode[];
  edges?: RawFlowEdge[];
}

// ---------------------------------------------------------------------------
// 3) 视觉受限枚举与增量操作契约（对齐后端 patch.schema.ts）
// ---------------------------------------------------------------------------

export const BORDER_STYLES = ['solid', 'dashed', 'dotted'] as const;
export type BorderStyle = (typeof BORDER_STYLES)[number];

export const FONT_SIZES = [12, 14, 16, 18, 20] as const;
export type FontSize = (typeof FONT_SIZES)[number];

export interface VisualChange {
  borderStyle?: BorderStyle;
  /** 1~5 */
  borderWidth?: number;
  /** #RRGGBB */
  fillColor?: string;
  /** #RRGGBB */
  fontColor?: string;
  fontSize?: FontSize;
}

export const DIRECTIONS = ['top', 'bottom', 'left', 'right'] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** 后端 PositionSchema：按 label 定位参照节点 + 四向 */
export interface RelativePosition {
  relativeTo: { label: string };
  direction: Direction;
}

/**
 * 节点定位目标。后端 patch 只用 oldLabel 定位、不带 id（这正是四级降级匹配存在的原因），
 * 但模型/上游也可能带上 id 或 oldId，此时匹配层走 L1 精确匹配。
 */
export interface PatchNodeTarget {
  type: 'node';
  oldLabel?: string;
  id?: string;
  oldId?: string;
}

/** 边定位目标：oldLabel（边自身标签）或 source/target 端点 */
export interface PatchEdgeTarget {
  type: 'edge';
  oldLabel?: string;
  label?: string;
  source?: string;
  target?: string;
  id?: string;
  oldId?: string;
}

export interface ModifyNodeOp {
  op: 'modify_node';
  target: PatchNodeTarget;
  semantic?: { label?: string; nodeType?: NodeType };
  visual?: VisualChange;
}

export interface ModifyEdgeOp {
  op: 'modify_edge';
  target: PatchEdgeTarget;
  semantic?: { label?: string };
  visual?: VisualChange;
}

export interface AddNodeOp {
  op: 'add_node';
  semantic: { label: string; nodeType: NodeType };
  position: RelativePosition;
}

export interface AddEdgeOp {
  op: 'add_edge';
  semantic: { source: string; target: string; label?: string };
}

export interface DeleteNodeOp {
  op: 'delete_node';
  target: PatchNodeTarget;
}

export interface DeleteEdgeOp {
  op: 'delete_edge';
  target: PatchEdgeTarget;
}

export interface RepositionOp {
  op: 'reposition';
  target: PatchNodeTarget;
  position: RelativePosition;
}

export const PATCH_OPS = [
  'modify_node',
  'modify_edge',
  'add_node',
  'add_edge',
  'delete_node',
  'delete_edge',
  'reposition',
] as const;

export type PatchOpKind = (typeof PATCH_OPS)[number];

export type PatchOperation =
  | ModifyNodeOp
  | ModifyEdgeOp
  | AddNodeOp
  | AddEdgeOp
  | DeleteNodeOp
  | DeleteEdgeOp
  | RepositionOp;

/** 后端 ModifyPatchOutput */
export interface ModifyPatchOutput {
  operations: PatchOperation[];
}

// ---------------------------------------------------------------------------
// 4) 几何基础类型（布局层 / 碰撞检测 / 新节点定位共用）
// ---------------------------------------------------------------------------

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

/** 矩形包围盒：x/y 为左上角（与 X6 node.x/node.y 语义一致） */
export interface Rect extends Point, Size {}

// ---------------------------------------------------------------------------
// 5) X6 图数据结构类型（纯数据，不 import @antv/x6 运行时实例）
//    转换层输出可直接喂给 graph.fromJSON(...)
// ---------------------------------------------------------------------------

export type X6AttrValue =
  | string
  | number
  | boolean
  | null
  | X6AttrValueObject
  | X6AttrValue[];

export interface X6AttrValueObject {
  [key: string]: X6AttrValue;
}

/** attrs: { [selector]: { [attrName]: value } } */
export type X6Attrs = Record<string, X6AttrValueObject>;

export interface X6MarkupItem {
  tagName: string;
  selector?: string;
  groupSelector?: string;
  className?: string;
  attrs?: X6AttrValueObject;
}

export interface X6PortCircleAttrs extends X6AttrValueObject {
  r: number;
  magnet: boolean;
  stroke: string;
  strokeWidth: number;
  fill: string;
  visibility: string;
}

export interface X6PortGroupDef {
  position: string;
  attrs: { circle: X6PortCircleAttrs };
}

export interface X6PortItem {
  id: string;
  group: string;
}

export interface X6Ports {
  groups: Record<string, X6PortGroupDef>;
  items: X6PortItem[];
}

/** 写在 node.data 上的语义元信息，供匹配层 / 配置面板 / 序列化回读使用 */
export interface X6NodeMeta {
  /** 归一化后的语义类型（非法 type 已降级为 process） */
  nodeType: NodeType;
  /** 模型原始输出的 type（可能非法或缺失），用于「界面提示降级项」 */
  rawType?: string;
  label: string;
  /** 是否发生类型降级 */
  degraded: boolean;
  /** 数据来源，便于区分 AI 生成节点与用户手绘节点 */
  origin?: 'ai-generate' | 'ai-modify' | 'canvas';
  visual?: VisualChange;
}

export interface X6EdgeMeta {
  label?: string;
  origin?: 'ai-generate' | 'ai-modify' | 'canvas';
  visual?: VisualChange;
}

export interface X6NodeData {
  id: string;
  shape: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex?: number;
  attrs?: X6Attrs;
  markup?: X6MarkupItem[];
  ports?: X6Ports;
  data?: X6NodeMeta;
}

export interface X6EdgeEndpoint {
  cell: string;
  port?: string;
}

export interface X6EdgeLabel {
  position?: number | { distance: number; offset?: number };
  attrs?: X6Attrs;
}

export interface X6EdgeData {
  id: string;
  shape: 'edge';
  source: X6EdgeEndpoint;
  target: X6EdgeEndpoint;
  labels?: X6EdgeLabel[];
  attrs?: X6Attrs;
  router?: { name: string; args?: X6AttrValueObject };
  connector?: { name: string; args?: X6AttrValueObject };
  zIndex?: number;
  data?: X6EdgeMeta;
}

export type X6CellData = X6NodeData | X6EdgeData;

/** flowDraftToX6 的输出，可直接 graph.fromJSON(data) */
export interface X6GraphData {
  nodes: X6NodeData[];
  edges: X6EdgeData[];
}

/** graph.toJSON() 的回读结构（宽松，用于 x6ToFlowDraft / 画布快照） */
export interface X6CellJSON {
  id?: string;
  shape?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  source?: X6EdgeEndpoint | string;
  target?: X6EdgeEndpoint | string;
  labels?: X6EdgeLabel[];
  attrs?: X6Attrs;
  data?: X6NodeMeta | X6EdgeMeta | Record<string, unknown>;
  [key: string]: unknown;
}

/**
 * 可被回读函数接受的单元：既包括 graph.toJSON() 的宽松结构，
 * 也包括本转换层自己产出的 X6NodeData / X6EdgeData（便于「转换结果直接回读」做往返校验）。
 */
export type X6CellLike = X6CellJSON | X6NodeData | X6EdgeData;

export interface X6GraphJSON {
  nodes?: readonly X6CellLike[];
  edges?: readonly X6CellLike[];
  cells?: readonly X6CellLike[];
}
