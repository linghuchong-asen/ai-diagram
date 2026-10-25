// 语图技术方案 - frontend/index.md「新节点定位：相对位置解析 + 质心兜底 + 碰撞规避」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 2.3
// 规则要点：
//   1. add_node / reposition 的 position 是「按 label 找参照节点 + 四向」的相对位置，
//      由 resolveRelativePosition 换算为画布坐标；参照节点找不到时降级为相连节点质心；
//   2. 质心兜底：取相连（已通过 add_edge 关联）节点包围盒中心均值作为候选点；
//   3. 候选点若与既有节点重叠，用 collision.ts 的「先下后右」步进搜索避让；
//   4. **绝不修改既有节点坐标**：本模块对 existing 只读，仅返回新节点的落点。
// 纯函数、无副作用。

import { getNodeSize } from '../transform/node-type-config';
import { labelEquals } from '../shared/label';
import type { Direction, NodeType, Point, Rect, RelativePosition, Size } from '../transform/types';
import { NODE_GAP } from './auto-layout';
import {
  DEFAULT_COLLISION_PADDING,
  DEFAULT_MAX_STEPS,
  DEFAULT_STEP_DX,
  DEFAULT_STEP_DY,
  findFreeSpotDetailed,
  hasCollision,
  rectCenter,
  toRect,
} from './collision';

/** 找不到参照节点也找不到相连节点时的兜底落点 */
export const FALLBACK_POINT: Point = { x: 60, y: 60 };

/** 新节点定位策略（写入结果，供 UI 说明「为什么放这里」） */
export type PlaceStrategy = 'relative' | 'centroid' | 'fallback';

/** 画布已有节点（只读快照） */
export interface PlacedNodeRef {
  id: string;
  label?: string;
  type?: NodeType;
  x: number;
  y: number;
  /** 缺省时按 getNodeSize(type) 推算，仍缺省则用 140×50 */
  width?: number;
  height?: number;
}

export interface PlaceNewNodeOptions {
  /** 新节点尺寸，缺省按 getNodeSize(type) */
  size?: Size;
  /** 与参照/相邻节点的净间距 */
  nodeGap?: number;
  /** 碰撞避让步长与上限 */
  dx?: number;
  dy?: number;
  maxSteps?: number;
  /** 碰撞判定留白 */
  padding?: number;
}

export interface PlaceNewNodeInput {
  type?: NodeType;
  label?: string;
  /** 相对位置（后端 add_node.position / reposition.position） */
  position?: RelativePosition;
  /** 相连节点 id（通常由同批次 add_edge 推导），用于质心兜底 */
  neighborIds?: string[];
  /** 画布已有节点 */
  existing: readonly PlacedNodeRef[];
}

export interface PlaceNewNodeResult {
  /** 新节点左上角坐标 */
  point: Point;
  rect: Rect;
  strategy: PlaceStrategy;
  /** 参照节点 id（strategy === 'relative' 时存在） */
  referenceId?: string;
  /** 是否因碰撞被步进偏移过 */
  shifted: boolean;
  /** 避让是否成功（false 表示达到 maxSteps 仍重叠，需人工调整） */
  resolved: boolean;
  attempts: number;
}

function sizeOfRef(ref: PlacedNodeRef): Size {
  if (typeof ref.width === 'number' && typeof ref.height === 'number') {
    return { width: ref.width, height: ref.height };
  }
  if (ref.type) return getNodeSize(ref.type);
  return { width: 140, height: 50 };
}

/** 已有节点 → 矩形（不修改入参） */
export function toOccupiedRects(existing: readonly PlacedNodeRef[]): Rect[] {
  return existing.map((ref) => {
    const size = sizeOfRef(ref);
    return { x: ref.x, y: ref.y, width: size.width, height: size.height };
  });
}

/** 按 label 查参照节点（归一化比较），返回第一个命中项 */
export function findReferenceNode(
  position: RelativePosition | undefined,
  existing: readonly PlacedNodeRef[],
): PlacedNodeRef | undefined {
  if (!position) return undefined;
  const wanted = position.relativeTo?.label;
  if (!wanted) return undefined;
  return existing.find((ref) => labelEquals(ref.label, wanted));
}

/**
 * 相对位置解析：把「参照节点 + 四向」换算为新节点左上角坐标。
 * 新节点在对应方向上与参照节点居中对齐，并保留 nodeGap 净间距。
 */
export function resolveRelativePosition(
  reference: Rect,
  direction: Direction,
  size: Size,
  nodeGap: number = NODE_GAP,
): Point {
  const refCenter = rectCenter(reference);
  switch (direction) {
    case 'top':
      return {
        x: refCenter.x - size.width / 2,
        y: reference.y - nodeGap - size.height,
      };
    case 'bottom':
      return {
        x: refCenter.x - size.width / 2,
        y: reference.y + reference.height + nodeGap,
      };
    case 'left':
      return {
        x: reference.x - nodeGap - size.width,
        y: refCenter.y - size.height / 2,
      };
    case 'right':
    default:
      return {
        x: reference.x + reference.width + nodeGap,
        y: refCenter.y - size.height / 2,
      };
  }
}

/** 相连节点质心（包围盒中心均值）；无相连节点返回 undefined */
export function centroidOfNeighbors(
  neighborIds: readonly string[] | undefined,
  existing: readonly PlacedNodeRef[],
): Point | undefined {
  if (!neighborIds || neighborIds.length === 0) return undefined;
  const wanted = new Set(neighborIds);
  const matched = existing.filter((ref) => wanted.has(ref.id));
  if (matched.length === 0) return undefined;
  let sumX = 0;
  let sumY = 0;
  matched.forEach((ref) => {
    const size = sizeOfRef(ref);
    const center = rectCenter({ x: ref.x, y: ref.y, width: size.width, height: size.height });
    sumX += center.x;
    sumY += center.y;
  });
  return { x: sumX / matched.length, y: sumY / matched.length };
}

/**
 * 计算新节点落点：相对位置 → 质心 → 兜底原点，再统一做碰撞避让。
 * 既有节点坐标只读，绝不被修改。
 */
export function placeNewNode(input: PlaceNewNodeInput, options?: PlaceNewNodeOptions): PlaceNewNodeResult {
  const type: NodeType = input.type ?? 'process';
  const size = options?.size ?? getNodeSize(type);
  const nodeGap = options?.nodeGap ?? NODE_GAP;
  const padding = options?.padding ?? DEFAULT_COLLISION_PADDING;
  const occupied = toOccupiedRects(input.existing);

  const reference = findReferenceNode(input.position, input.existing);
  let strategy: PlaceStrategy = 'fallback';
  let candidate: Point = FALLBACK_POINT;
  let referenceId: string | undefined;

  if (reference && input.position) {
    const refSize = sizeOfRef(reference);
    const refRect = toRect({ x: reference.x, y: reference.y }, refSize);
    candidate = resolveRelativePosition(refRect, input.position.direction, size, nodeGap);
    strategy = 'relative';
    referenceId = reference.id;
  } else {
    const centroid = centroidOfNeighbors(input.neighborIds, input.existing);
    if (centroid) {
      // 质心作为新节点中心 → 换算左上角
      candidate = { x: centroid.x - size.width / 2, y: centroid.y - size.height / 2 };
      strategy = 'centroid';
    }
  }

  const rect = toRect({ x: Math.round(candidate.x), y: Math.round(candidate.y) }, size);
  const shifted = hasCollision(rect, occupied, padding);
  const report = findFreeSpotDetailed(rect, occupied, {
    dx: options?.dx ?? DEFAULT_STEP_DX,
    dy: options?.dy ?? DEFAULT_STEP_DY,
    maxSteps: options?.maxSteps ?? DEFAULT_MAX_STEPS,
    padding,
  });

  const result: PlaceNewNodeResult = {
    point: { x: report.rect.x, y: report.rect.y },
    rect: report.rect,
    strategy,
    shifted,
    resolved: report.resolved,
    attempts: report.attempts,
  };
  if (referenceId !== undefined) result.referenceId = referenceId;
  return result;
}
