// 语图技术方案 - FlowDraft(generate 场景输出结构)
// 确定性程序优先:模型只输出语义结构(节点/边/类型),无坐标、无样式、无 ports
// 坐标样式由前端转换层程序化生成
import { z } from 'zod';
import { FlowNodeSchema } from './node.schema';

export const FlowEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.string().optional(),
});

export const FlowDraftSchema = z.object({
  nodes: z.array(FlowNodeSchema).min(2, '流程图至少需要 2 个节点'),
  edges: z.array(FlowEdgeSchema),
});

export type FlowEdge = z.infer<typeof FlowEdgeSchema>;
export type FlowDraft = z.infer<typeof FlowDraftSchema>;
