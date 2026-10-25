// 语图技术方案 - 节点类型契约
// NodeType 六种:start(椭圆绿)/end(椭圆红)/process(圆角矩形蓝)/decision(菱形橙)/io(平行四边形紫)/subprocess(双线框青)
import { z } from 'zod';

export const NODE_TYPES = [
  'start',
  'end',
  'process',
  'decision',
  'io',
  'subprocess',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

// 节点类型 → 形状与配色(由前端转换层消费,模型不输出坐标与样式)
export const NODE_TYPE_META: Record<
  NodeType,
  { shape: string; fill: string; stroke: string; text: string }
> = {
  start: { shape: 'ellipse', fill: '#E6FFE6', stroke: '#52C41A', text: '#389E0D' },
  end: { shape: 'ellipse', fill: '#FFF1F0', stroke: '#FF4D4F', text: '#CF1322' },
  process: { shape: 'rect', fill: '#E6F4FF', stroke: '#1677FF', text: '#0958D9' },
  decision: { shape: 'diamond', fill: '#FFF7E6', stroke: '#FA8C16', text: '#D46B08' },
  io: { shape: 'parallelogram', fill: '#F9F0FF', stroke: '#722ED1', text: '#531DAB' },
  subprocess: { shape: 'double-rect', fill: '#E6FFFB', stroke: '#13C2C2', text: '#08979C' },
};

// 模型输出的 FlowNode —— 语义结构,无坐标、无样式、无 ports
export const FlowNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(NODE_TYPES),
});

// 画布语义摘要(带 ID,用于 modify 场景定位)
export const CanvasNodeSchema = z.object({
  id: z.string(),
  label: z.string(),
  type: z.enum(NODE_TYPES),
});

export type FlowNode = z.infer<typeof FlowNodeSchema>;
export type CanvasNode = z.infer<typeof CanvasNodeSchema>;
