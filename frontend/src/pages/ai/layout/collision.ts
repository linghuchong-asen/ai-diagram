// 语图技术方案 - frontend/index.md「程序化布局：矩形碰撞检测与规避」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 2.2
// 用途：替代 @antv/layout（本项目禁止新增依赖），提供「候选位置是否压盖已有节点」的判定，
//      以及「先下后右」的步进式避让搜索。
// 纯函数、无副作用：所有函数都不修改入参数组与入参对象，只返回新对象。

import type { Point, Rect, Size } from '../transform/types';

/** 步进避让的默认横向步长 */
export const DEFAULT_STEP_DX = 180;
/** 步进避让的默认纵向步长 */
export const DEFAULT_STEP_DY = 100;
/** 步进搜索上限，防止死循环（超出后原样返回，由调用方决定是否提示） */
export const DEFAULT_MAX_STEPS = 200;
/** 默认节点间最小留白 */
export const DEFAULT_COLLISION_PADDING = 10;

export interface CollisionOptions {
  /** 横向步长（向右避让） */
  dx?: number;
  /** 纵向步长（向下避让） */
  dy?: number;
  /** 最大步进次数 */
  maxSteps?: number;
  /** 判定重叠时额外扩张的留白（0 表示仅判定几何相交） */
  padding?: number;
}

export interface FreeSpotReport {
  rect: Rect;
  /** 是否真的找到了空位（false 表示达到 maxSteps 仍未避让成功） */
  resolved: boolean;
  /** 实际尝试的步数（0 表示原位即空位） */
  attempts: number;
}

/** 由左上角坐标 + 尺寸构造矩形 */
export function toRect(pos: Point, size: Size): Rect {
  return { x: pos.x, y: pos.y, width: size.width, height: size.height };
}

/** 取矩形中心点（新节点定位时求相连节点质心用） */
export function rectCenter(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * 两矩形是否重叠。padding > 0 时按「外扩留白」判定，避免节点紧贴。
 * 采用严格相交判定：仅边相邻（a 右边 == b 左边）不算重叠。
 */
export function rectsOverlap(a: Rect, b: Rect, padding: number = 0): boolean {
  const ax2 = a.x + a.width + padding;
  const ay2 = a.y + a.height + padding;
  const bx2 = b.x + b.width + padding;
  const by2 = b.y + b.height + padding;
  return a.x - padding < bx2 && b.x - padding < ax2 && a.y - padding < by2 && b.y - padding < ay2;
}

/** 候选矩形是否与任一已有矩形重叠 */
export function hasCollision(
  rect: Rect,
  others: readonly Rect[],
  padding: number = DEFAULT_COLLISION_PADDING,
): boolean {
  for (let i = 0; i < others.length; i += 1) {
    const other = others[i];
    if (!other) continue;
    if (other === rect) continue;
    if (rectsOverlap(rect, other, padding)) return true;
  }
  return false;
}

/**
 * 「先下后右」步进搜索空位：
 * 第 i 步先试 (x, y + dy*i)，再试 (x + dx*i, y)；命中即返回。
 * 达到 maxSteps 仍无空位时返回 detailed.resolved = false，rect 为最后一次尝试的位置。
 */
export function findFreeSpotDetailed(
  rect: Rect,
  others: readonly Rect[],
  options?: CollisionOptions,
): FreeSpotReport {
  const dx = options?.dx ?? DEFAULT_STEP_DX;
  const dy = options?.dy ?? DEFAULT_STEP_DY;
  const maxSteps = options?.maxSteps ?? DEFAULT_MAX_STEPS;
  const padding = options?.padding ?? DEFAULT_COLLISION_PADDING;

  if (!hasCollision(rect, others, padding)) {
    return { rect: { ...rect }, resolved: true, attempts: 0 };
  }

  let attempts = 0;
  let last: Rect = { ...rect };
  for (let step = 1; step <= maxSteps; step += 1) {
    // 先下
    attempts += 1;
    const down: Rect = { ...rect, y: rect.y + dy * step };
    last = down;
    if (!hasCollision(down, others, padding)) {
      return { rect: down, resolved: true, attempts };
    }
    // 后右
    attempts += 1;
    const right: Rect = { ...rect, x: rect.x + dx * step };
    last = right;
    if (!hasCollision(right, others, padding)) {
      return { rect: right, resolved: true, attempts };
    }
  }
  return { rect: last, resolved: false, attempts };
}

/** findFreeSpotDetailed 的简化版：只返回最终矩形 */
export function findFreeSpot(rect: Rect, others: readonly Rect[], options?: CollisionOptions): Rect {
  return findFreeSpotDetailed(rect, others, options).rect;
}

/**
 * 批量消解重叠：按输入顺序依次落位，后落位的节点避让先落位的节点。
 * 返回与输入等长的新数组，绝不修改入参（既有节点坐标只在必要时被后加入者让位，
 * 若需「完全不动既有节点」请使用 place-new-node.ts 的 placeNewNode）。
 */
export function resolveCollisions(rects: readonly Rect[], options?: CollisionOptions): Rect[] {
  const padding = options?.padding ?? DEFAULT_COLLISION_PADDING;
  const placed: Rect[] = [];
  rects.forEach((rect) => {
    if (!rect) return;
    const report = findFreeSpotDetailed({ ...rect }, placed, { ...options, padding });
    placed.push(report.rect);
  });
  return placed;
}
