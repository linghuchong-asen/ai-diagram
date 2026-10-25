// 语图技术方案 - frontend/index.md「NODE_TYPE_CONFIG：6 种语义节点映射规则」
// 对应 .trae/specs/align-yutu-doc-and-code/tasks.md Task 1.1
// 规则要点：
//   1. 模型只输出语义（id/label/type），形状、尺寸、配色、样式全部由本转换层程序化决定；
//   2. 配色与后端 serverend/src/ai/schemas/node.schema.ts 的 NODE_TYPE_META 严格一致；
//   3. 形状尺寸：start/end 椭圆 120×50、process 圆角矩形 140×50、
//      decision 菱形 refPoints '0,40 70,0 140,40 70,80'（140×80）、
//      io 平行四边形 refPoints '20,0 140,0 120,50 0,50'（140×50）、
//      subprocess 双线框 140×50；
//   4. 未知/缺失 type → 降级为 process 渲染，不抛异常、不中断整图（degraded 标记供 UI 提示）。
// 本文件为纯常量 + 纯函数，无副作用，不 import React / @antv/x6 运行时。

import type {
  NodeType,
  VisualChange,
  X6AttrValueObject,
  X6Attrs,
  X6MarkupItem,
} from './types';
import { NODE_TYPES } from './types';

/** X6 v1 内置可渲染 shape（diamond/parallelogram 用 polygon + refPoints 表达） */
export type X6ShapeName = 'ellipse' | 'rect' | 'polygon';

export interface NodeTypeConfig {
  /** X6 实际使用的 shape */
  shape: X6ShapeName;
  /** 后端 NODE_TYPE_META 中的语义 shape 名（diamond / parallelogram / double-rect 等） */
  semanticShape: string;
  width: number;
  height: number;
  fill: string;
  stroke: string;
  text: string;
  strokeWidth: number;
  /** 圆角半径（process / subprocess） */
  rx?: number;
  /** polygon 顶点（相对 0,0 的绝对坐标，与 width/height 对应） */
  refPoints?: string;
  /** 额外 markup（subprocess 内框） */
  markup?: X6MarkupItem[];
  /** 额外 attrs（subprocess 内框），与 body/label 合并 */
  extraAttrs?: X6Attrs;
  /** 中文展示名 */
  label: string;
}

/** 未知/非法类型的降级目标 */
export const DEFAULT_NODE_TYPE: NodeType = 'process';

export const NODE_TYPE_CONFIG: Record<NodeType, NodeTypeConfig> = {
  start: {
    shape: 'ellipse',
    semanticShape: 'ellipse',
    width: 120,
    height: 50,
    fill: '#E6FFE6',
    stroke: '#52C41A',
    text: '#389E0D',
    strokeWidth: 1.5,
    label: '开始',
  },
  end: {
    shape: 'ellipse',
    semanticShape: 'ellipse',
    width: 120,
    height: 50,
    fill: '#FFF1F0',
    stroke: '#FF4D4F',
    text: '#CF1322',
    strokeWidth: 1.5,
    label: '结束',
  },
  process: {
    shape: 'rect',
    semanticShape: 'rect',
    width: 140,
    height: 50,
    fill: '#E6F4FF',
    stroke: '#1677FF',
    text: '#0958D9',
    strokeWidth: 1.5,
    rx: 6,
    label: '处理',
  },
  decision: {
    shape: 'polygon',
    semanticShape: 'diamond',
    width: 140,
    height: 80,
    fill: '#FFF7E6',
    stroke: '#FA8C16',
    text: '#D46B08',
    strokeWidth: 1.5,
    refPoints: '0,40 70,0 140,40 70,80',
    label: '判断',
  },
  io: {
    shape: 'polygon',
    semanticShape: 'parallelogram',
    width: 140,
    height: 50,
    fill: '#F9F0FF',
    stroke: '#722ED1',
    text: '#531DAB',
    strokeWidth: 1.5,
    refPoints: '20,0 140,0 120,50 0,50',
    label: '输入/输出',
  },
  subprocess: {
    shape: 'rect',
    semanticShape: 'double-rect',
    width: 140,
    height: 50,
    fill: '#E6FFFB',
    stroke: '#13C2C2',
    text: '#08979C',
    strokeWidth: 1.5,
    rx: 4,
    markup: [
      { tagName: 'rect', selector: 'body' },
      { tagName: 'rect', selector: 'inner' },
      { tagName: 'text', selector: 'label' },
    ],
    extraAttrs: {
      inner: {
        refX: '6%',
        refY: '12%',
        refWidth: '88%',
        refHeight: '76%',
        fill: 'none',
        stroke: '#13C2C2',
        strokeWidth: 1,
      },
    },
    label: '子流程',
  },
};

export const NODE_TYPE_LABEL: Record<NodeType, string> = {
  start: NODE_TYPE_CONFIG.start.label,
  end: NODE_TYPE_CONFIG.end.label,
  process: NODE_TYPE_CONFIG.process.label,
  decision: NODE_TYPE_CONFIG.decision.label,
  io: NODE_TYPE_CONFIG.io.label,
  subprocess: NODE_TYPE_CONFIG.subprocess.label,
};

export interface ResolvedNodeType {
  /** 归一化后的合法类型（非法/缺失 → process） */
  type: NodeType;
  /** 是否发生降级（供界面提示降级项） */
  degraded: boolean;
  /** 模型原始输出（可能为 undefined / 非法字符串），仅用于提示 */
  rawType?: string;
}

/** 类型守卫：值是否为 6 种合法语义类型之一（转换层 / 匹配层复用） */
export function isNodeType(value: unknown): value is NodeType {
  return typeof value === 'string' && (NODE_TYPES as readonly string[]).indexOf(value) >= 0;
}

/**
 * 类型归一化 + 降级：type 缺失或不在 6 种枚举内时降级为 process，绝不抛异常。
 */
export function resolveNodeType(raw: unknown): ResolvedNodeType {
  if (isNodeType(raw)) {
    return { type: raw, degraded: false };
  }
  const rawType = typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  return { type: DEFAULT_NODE_TYPE, degraded: true, rawType };
}

/** 取节点类型配置（内部已保证入参合法；非法入参走降级） */
export function getNodeConfig(type: NodeType): NodeTypeConfig {
  return NODE_TYPE_CONFIG[type] ?? NODE_TYPE_CONFIG[DEFAULT_NODE_TYPE];
}

/** 取节点尺寸（布局层与碰撞检测复用，保证「布局消费的尺寸」与「渲染尺寸」同源） */
export function getNodeSize(type: NodeType): { width: number; height: number } {
  const config = getNodeConfig(type);
  return { width: config.width, height: config.height };
}

const DASH_PATTERN: Record<string, string> = {
  solid: '',
  dashed: '6 3',
  dotted: '2 2',
};

/**
 * 由类型配置 + 可选视觉变更生成 X6 attrs。
 * visual 为受限枚举（后端 VisualChangeSchema 白名单），此处只做映射不做校验。
 */
export function buildNodeAttrs(type: NodeType, visual?: VisualChange): X6Attrs {
  const config = getNodeConfig(type);
  const body: X6AttrValueObject = {
    fill: config.fill,
    stroke: config.stroke,
    strokeWidth: config.strokeWidth,
  };
  if (config.shape === 'rect') {
    body.rx = config.rx ?? 0;
    body.ry = config.rx ?? 0;
  }
  if (config.shape === 'polygon' && config.refPoints) {
    body.refPoints = config.refPoints;
  }

  const label: X6AttrValueObject = {
    fill: config.text,
    fontSize: 12,
    refX: '50%',
    refY: '50%',
    textAnchor: 'middle',
    textVerticalAlign: 'middle',
    textWrap: { width: -10, height: -10, ellipsis: true },
  };

  if (visual) {
    if (visual.fillColor) body.fill = visual.fillColor;
    if (typeof visual.borderWidth === 'number') body.strokeWidth = visual.borderWidth;
    if (visual.borderStyle) {
      const dash = DASH_PATTERN[visual.borderStyle];
      if (dash) {
        body.strokeDasharray = dash;
      } else {
        delete body.strokeDasharray;
      }
    }
    if (visual.fontColor) label.fill = visual.fontColor;
    if (typeof visual.fontSize === 'number') label.fontSize = visual.fontSize;
  }

  const attrs: X6Attrs = { body, label };
  if (config.extraAttrs) {
    // 深拷贝一层 selector，避免修改 NODE_TYPE_CONFIG 常量（纯函数无副作用）
    Object.keys(config.extraAttrs).forEach((selector) => {
      attrs[selector] = { ...config.extraAttrs?.[selector] };
    });
    // 内框描边跟随主体描边，避免双线框配色割裂
    const inner = attrs.inner;
    if (inner && typeof inner.stroke === 'string') {
      inner.stroke = body.stroke;
    }
  }
  return attrs;
}

/** 边默认样式（X6 edge attrs.line）—— 与 useGraph createEdge 的手动连线同色 */
export function buildEdgeAttrs(visual?: VisualChange): X6Attrs {
  const line: X6AttrValueObject = {
    stroke: '#7d8fb0',
    strokeWidth: 1.5,
    targetMarker: { name: 'block', width: 10, height: 8 },
  };
  if (visual) {
    if (visual.fillColor) line.stroke = visual.fillColor;
    if (typeof visual.borderWidth === 'number') line.strokeWidth = visual.borderWidth;
    if (visual.borderStyle) {
      const dash = DASH_PATTERN[visual.borderStyle];
      if (dash) line.strokeDasharray = dash;
    }
  }
  return { line };
}
