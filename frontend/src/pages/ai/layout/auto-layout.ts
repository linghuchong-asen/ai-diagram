// 语图技术方案 - frontend/index.md「程序化布局：拓扑分层 + 从上到下排列」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 2.1
// 说明：本项目禁止新增依赖（不引入 @antv/layout），故自行实现「最长路径深度分层」布局：
//   1. 分层：迭代松弛 level(target) = max(level(target), level(source)+1)，
//      迭代上限 guard = 节点数² + 1，环图不会死循环（与 ai_float_window.tsx 的 FlowPreview 同策略）；
//   2. 排列：从上到下，同层节点横向铺开，层间 LEVEL_GAP、节点间 NODE_GAP、四周 PADDING；
//   3. 居中：每层按最宽层水平居中对齐，输出坐标确定性（同输入同输出）；
//   4. 尺寸与渲染同源：调用 getNodeSize(type)，避免布局尺寸与实际形状尺寸不一致导致重叠。
// 纯函数、无副作用：不修改入参，返回新对象。

import { getNodeSize } from '../transform/node-type-config';
import type { NodeType, Point, Size } from '../transform/types';

/** 层间距（上一层顶边到下一层顶边的纵向距离基准） */
export const LEVEL_GAP = 110;
/** 同层节点水平间距 */
export const NODE_GAP = 60;
/** 画布四周留白 */
export const PADDING = 60;

export interface LayoutNodeLike {
  id: string;
  type: NodeType;
}

export interface LayoutEdgeLike {
  source: string;
  target: string;
}

export interface AutoLayoutOptions {
  levelGap?: number;
  nodeGap?: number;
  padding?: number;
  /** 自定义节点尺寸（默认按 getNodeSize 取渲染尺寸） */
  sizeOf?: (type: NodeType) => Size;
}

export interface AutoLayoutResult {
  /** 节点 id → 左上角坐标，可直接作为 flowDraftToX6 的 positions */
  positions: Record<string, Point>;
  /** 节点 id → 层级（0 起） */
  levels: Record<string, number>;
  /** 每层节点 id（按输入顺序稳定排列） */
  layers: string[][];
  /** 最大层级 */
  maxLevel: number;
  /** 布局整体包围盒宽高 */
  width: number;
  height: number;
}

/**
 * 计算分层（最长路径深度）。环图安全：guard 耗尽后以当前结果收敛，不抛异常。
 */
export function computeLevels(
  nodes: readonly LayoutNodeLike[],
  edges: readonly LayoutEdgeLike[],
): { levels: Record<string, number>; maxLevel: number } {
  const levels: Record<string, number> = {};
  nodes.forEach((node) => {
    levels[node.id] = 0;
  });

  let changed = true;
  let guard = nodes.length * nodes.length + 1;
  while (changed && guard > 0) {
    guard -= 1;
    changed = false;
    edges.forEach((edge) => {
      if (edge.source === edge.target) return; // 自环：不构成层级约束
      const sourceLevel = levels[edge.source];
      if (sourceLevel === undefined) return; // 悬空边：忽略
      const targetLevel = levels[edge.target];
      if (targetLevel === undefined) return;
      if (targetLevel <= sourceLevel) {
        levels[edge.target] = sourceLevel + 1;
        changed = true;
      }
    });
  }

  let maxLevel = 0;
  nodes.forEach((node) => {
    const level = levels[node.id] ?? 0;
    if (level > maxLevel) maxLevel = level;
  });
  return { levels, maxLevel };
}

/**
 * 拓扑分层自动布局（从上到下）。输入可为 FlowDraft 的 nodes/edges（结构兼容）。
 */
export function autoLayout(
  nodes: readonly LayoutNodeLike[],
  edges: readonly LayoutEdgeLike[],
  options?: AutoLayoutOptions,
): AutoLayoutResult {
  const levelGap = options?.levelGap ?? LEVEL_GAP;
  const nodeGap = options?.nodeGap ?? NODE_GAP;
  const padding = options?.padding ?? PADDING;
  const sizeOf = options?.sizeOf ?? ((type: NodeType) => getNodeSize(type));

  const positions: Record<string, Point> = {};
  if (nodes.length === 0) {
    return { positions, levels: {}, layers: [], maxLevel: 0, width: padding * 2, height: padding * 2 };
  }

  const { levels, maxLevel } = computeLevels(nodes, edges);

  // 按层聚合，保持输入顺序 → 确定性
  const layers: string[][] = [];
  for (let level = 0; level <= maxLevel; level += 1) layers.push([]);
  nodes.forEach((node) => {
    const level = levels[node.id] ?? 0;
    layers[level]?.push(node.id);
  });

  const sizeById: Record<string, Size> = {};
  nodes.forEach((node) => {
    sizeById[node.id] = sizeOf(node.type);
  });

  // 每层高度取该层最大节点高度；层内宽度求和用于水平居中
  const layerHeight = layers.map((ids) =>
    ids.reduce((max, id) => Math.max(max, sizeById[id]?.height ?? 0), 0),
  );
  const layerWidth = layers.map((ids) =>
    ids.reduce((sum, id, index) => sum + (sizeById[id]?.width ?? 0) + (index > 0 ? nodeGap : 0), 0),
  );
  const maxLayerWidth = layerWidth.reduce((max, w) => Math.max(max, w), 0);

  let y = padding;
  layers.forEach((ids, level) => {
    // 层内居中：整体左边缘相对最宽层居中
    let x = padding + (maxLayerWidth - (layerWidth[level] ?? 0)) / 2;
    ids.forEach((id) => {
      const size = sizeById[id] ?? { width: 0, height: 0 };
      positions[id] = { x: Math.round(x), y: Math.round(y) };
      x += size.width + nodeGap;
    });
    // 下一层顶边 = 本层顶边 + 本层节点高度 + 层间距（LEVEL_GAP 为层与层之间的净空）
    y += (layerHeight[level] ?? 0) + levelGap;
  });

  const lastY = layers.reduce((acc, ids, level) => {
    if (ids.length === 0) return acc;
    const tops = ids.map((id) => (positions[id]?.y ?? 0) + (sizeById[id]?.height ?? 0));
    return Math.max(acc, ...tops);
  }, 0);

  return {
    positions,
    levels,
    layers,
    maxLevel,
    width: Math.round(maxLayerWidth + padding * 2),
    height: Math.round(lastY + padding),
  };
}
