// 语图技术方案 - frontend/index.md「PORT_GROUPS：四向连接桩定义 + 端口方向约定」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 1.2
// 规则要点：
//   1. 四向端口组 top/right/bottom/left，圆点 r=3、magnet=true，默认隐藏（hover 时由编辑器显示）；
//   2. 端口方向约定：start 仅暴露 bottom（只能出），end 仅暴露 top（只能入），其余类型四向；
//   3. port item 的 id 使用语义名（'top'/'right'/'bottom'/'left'），
//      区别于既有 src/pages/x6Editor/index.tsx 中用归一化坐标字符串（如 "[0.5,0]"）当 id 的写法，
//      语义 id 便于边端口计算与四级匹配层反查；
//   4. 纯数据 + 纯函数，不 import React / @antv/x6 运行时。

import type { NodeType, X6PortGroupDef, X6PortItem, X6Ports } from './types';

/** 四向端口名（固定顺序，保证同类型节点端口顺序稳定 → 转换结果确定性） */
export const PORT_DIRECTIONS = ['top', 'right', 'bottom', 'left'] as const;
export type PortDirection = (typeof PORT_DIRECTIONS)[number];

export interface PortGroupStyleOptions {
  r?: number;
  magnet?: boolean;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  visibility?: 'hidden' | 'visible';
}

/** 默认端口样式（与既有编辑器 ports.groups 保持一致，便于混用同一画布） */
export const DEFAULT_PORT_STYLE: Required<PortGroupStyleOptions> = {
  r: 3,
  magnet: true,
  stroke: '#7c86e8',
  strokeWidth: 2,
  fill: '#fff',
  visibility: 'hidden',
};

function createGroup(position: PortDirection, options?: PortGroupStyleOptions): X6PortGroupDef {
  const style = { ...DEFAULT_PORT_STYLE, ...options };
  return {
    position,
    attrs: {
      circle: {
        r: style.r,
        magnet: style.magnet,
        stroke: style.stroke,
        strokeWidth: style.strokeWidth,
        fill: style.fill,
        visibility: style.visibility,
      },
    },
  };
}

/** 四向端口组定义（groups 部分），可覆盖默认样式 */
export const PORT_GROUPS: Record<PortDirection, X6PortGroupDef> = {
  top: createGroup('top'),
  right: createGroup('right'),
  bottom: createGroup('bottom'),
  left: createGroup('left'),
};

/** 生成自定义样式的四向端口组（需要可见端口 / 不同配色时使用） */
export function createPortGroups(options?: PortGroupStyleOptions): Record<PortDirection, X6PortGroupDef> {
  return {
    top: createGroup('top', options),
    right: createGroup('right', options),
    bottom: createGroup('bottom', options),
    left: createGroup('left', options),
  };
}

/**
 * 按节点类型给出可用端口方向（端口方向约定）：
 *   start → 仅 bottom；end → 仅 top；其余 → 四向。
 * 非法/未知类型按 resolveNodeType 的降级结果传入 process，即四向。
 */
export function getPortsForType(type: NodeType): PortDirection[] {
  if (type === 'start') return ['bottom'];
  if (type === 'end') return ['top'];
  return [...PORT_DIRECTIONS];
}

/** 组装完整 X6 ports 结构（groups 恒定四向定义 + items 按类型裁剪） */
export function buildPorts(type: NodeType, options?: PortGroupStyleOptions): X6Ports {
  const directions = getPortsForType(type);
  const items: X6PortItem[] = directions.map((group) => ({ id: group, group }));
  return {
    groups: options ? createPortGroups(options) : PORT_GROUPS,
    items,
  };
}

/** 判断某端口方向对该类型是否可用（连边时的方向校验，避免 start 入边 / end 出边） */
export function isPortAllowed(type: NodeType, direction: PortDirection): boolean {
  return getPortsForType(type).indexOf(direction) >= 0;
}

/**
 * 由源/目标节点类型推导端口：
 *   源端取其可用方向中朝下的（start 只有 bottom；其余优先 bottom → right → left → top）
 *   目标端取其可用方向中朝上的（end 只有 top；其余优先 top → left → right → bottom）
 * 返回 undefined 表示该端无端口（此时边按节点中心连接，X6 自行处理）。
 */
export function pickSourcePort(type: NodeType): PortDirection | undefined {
  const order: PortDirection[] = ['bottom', 'right', 'left', 'top'];
  const allowed = getPortsForType(type);
  return order.find((d) => allowed.indexOf(d) >= 0);
}

export function pickTargetPort(type: NodeType): PortDirection | undefined {
  const order: PortDirection[] = ['top', 'left', 'right', 'bottom'];
  const allowed = getPortsForType(type);
  return order.find((d) => allowed.indexOf(d) >= 0);
}
