// 语图技术方案 - 思维导图布局纯函数（multi-artifact-batch Round 7）
// 定位：mindmap 是唯一「可进画布」的新形态。模型只输出语义树（无坐标），
//       本文件把树转成「节点坐标 + 父子边」——与 layout/auto-layout.ts 同一哲学：
//       确定性程序排版,模型不碰坐标。
// 算法：经典横向整洁树（tidy tree）——叶子按访问序均匀分布 y,父节点 y = 子节点 y 中点;
//       x 按层深等距推进。无需迭代,天然无重叠、深树不溢出。
import type { MindMapDraft, MindMapNode } from '../../../utils/aiClient';

/** 布局参数（与流程图节点尺寸体系对齐:process 140×50;留白足够容纳中文双行） */
export const MINDMAP_NODE_WIDTH = 140;
export const MINDMAP_NODE_HEIGHT = 44;
/** 层间水平间距 / 兄弟间垂直间距 */
export const MINDMAP_LEVEL_GAP_X = 90;
export const MINDMAP_SIBLING_GAP_Y = 64;

/** 布局输出：语义节点（含坐标）+ 父子边;画布尺寸供预览视口计算 */
export interface MindMapLayoutNode {
  id: string;
  label: string;
  /** 深度(根 = 1) */
  depth: number;
  x: number;
  y: number;
}

export interface MindMapLayoutEdge {
  source: string;
  target: string;
}

export interface MindMapLayout {
  nodes: MindMapLayoutNode[];
  edges: MindMapLayoutEdge[];
  /** 画布内容宽高（含节点自身尺寸,不含 padding） */
  width: number;
  height: number;
}

/** 中序展开:先给叶子编号,再回填父节点 y = 子节点 y 中点 */
export function layoutMindmap(draft: MindMapDraft): MindMapLayout {
  const nodes: MindMapLayoutNode[] = [];
  const edges: MindMapLayoutEdge[] = [];
  let nextLeafY = 0;

  // 第一遍:自底向上(后序遍历)确定每个节点的 y
  const assign = (node: MindMapNode, depth: number): number => {
    const x = (depth - 1) * (MINDMAP_NODE_WIDTH + MINDMAP_LEVEL_GAP_X);
    let y: number;
    if (node.children.length === 0) {
      // 叶子:顺序铺开
      y = nextLeafY * (MINDMAP_NODE_HEIGHT + MINDMAP_SIBLING_GAP_Y);
      nextLeafY += 1;
    } else {
      // 父:子节点 y 的中点
      const childYs = node.children.map((child) => assign(child, depth + 1));
      y = (Math.min(...childYs) + Math.max(...childYs)) / 2;
    }
    nodes.push({ id: node.id, label: node.label, depth, x, y });
    for (const child of node.children) {
      edges.push({ source: node.id, target: child.id });
    }
    return y;
  };
  assign(draft.root, 1);

  // 画布尺寸:最大 x/y + 节点自身尺寸
  const maxX = Math.max(...nodes.map((n) => n.x)) + MINDMAP_NODE_WIDTH;
  const maxY = Math.max(...nodes.map((n) => n.y)) + MINDMAP_NODE_HEIGHT;
  return { nodes, edges, width: maxX, height: maxY };
}

/**
 * mindmap 树 → 流程图 FlowDraft 形态（复用 autoLayout 之外的专用布局）。
 * 输出可直接喂给 transform/to-x6.ts 的 flowDraftToX6（process 节点 + positions 覆盖）,
 * 使「应用到画布」后的脑图在编辑器里可继续用全套流程图编辑能力。
 */
export function mindmapToFlowDraftLike(draft: MindMapDraft): {
  nodes: Array<{ id: string; label: string; type: string }>;
  edges: Array<{ id: string; source: string; target: string }>;
} {
  const nodes: Array<{ id: string; label: string; type: string }> = [];
  const edges: Array<{ id: string; source: string; target: string }> = [];
  let edgeCounter = 0;
  const walk = (node: MindMapNode) => {
    // 统一用 process 类型:脑图节点无起止/分支语义,语义节点体系里 process 是通用容器
    nodes.push({ id: node.id, label: node.label, type: 'process' });
    for (const child of node.children) {
      edgeCounter += 1;
      edges.push({ id: `me${edgeCounter}`, source: node.id, target: child.id });
      walk(child);
    }
  };
  walk(draft.root);
  return { nodes, edges };
}
