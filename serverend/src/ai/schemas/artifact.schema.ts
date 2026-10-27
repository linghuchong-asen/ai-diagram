// 语图技术方案 - 多形态产物 Schema（multi-artifact-batch Round 2）
// 背景：generate 意图不再等价于流程图。Agent 按「问题本质」选择最合适的产物形态：
//   有先后分支 → flowchart（既有旗舰）；有层级 → mindmap；多对象多维度 → table；
//   可勾选怕遗漏 → checklist；有时间轴 → timeline。
// 契约原则与 FlowDraft 一致：模型只输出语义结构（无坐标/样式），排版由前端程序化生成；
// 本文件只做「字段级格式约束」，跨字段的结构合理性（树深度/节点总数/空单元格占比等）
// 由 reflection/artifact.validator.ts 的第二层确定性校验负责——沿用「Zod 格式 + 结构遍历」两层哲学。
import { z } from 'zod';

/** 产物形态枚举：flowchart 为默认兜底（旗舰场景，向后兼容） */
export const ARTIFACT_KINDS = ['flowchart', 'mindmap', 'table', 'checklist', 'timeline'] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** 请求体 formHint 的独立 Schema（chat / trial 两个请求体复用；白名单外一律 400） */
export const ArtifactFormHintSchema = z.enum(ARTIFACT_KINDS);

// ---------------------------------------------------------------------------
// 思维导图：树形结构。id 全树唯一（前端转 X6 时作节点主键）；label 一词一节点（脑图习惯：短词发散）
// ---------------------------------------------------------------------------

/** 思维导图节点（递归定义） */
export interface MindMapNode {
  id: string;
  label: string;
  children: MindMapNode[];
}

/**
 * 递归 Schema：zod v4 下用 z.lazy + 显式类型标注（否则 TS 无法推断自引用类型）。
 * 单节点子项上限 8（防模型无限发散撑爆 token）；深度/总节点数由结构校验层把关。
 */
export const MindMapNodeSchema: z.ZodType<MindMapNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1, '思维导图节点 id 不能为空'),
    label: z.string().min(1, '思维导图节点 label 不能为空').max(50, '思维导图节点 label 过长（≤50 字，脑图节点应短词化）'),
    children: z.array(MindMapNodeSchema).max(8, '单个节点子项过多（≤8，请收敛层级）').default([]),
  }),
);

export const MindMapDraftSchema = z.object({
  root: MindMapNodeSchema,
});
export type MindMapDraft = z.infer<typeof MindMapDraftSchema>;

// ---------------------------------------------------------------------------
// 对比表格：列为「维度」、行为「对象/方案」；conclusion 为可选结论行（决策类痛点的推荐意见）
// ---------------------------------------------------------------------------

export const TableDraftSchema = z
  .object({
    /** 列名（维度名）：2~8 列，首列通常是对象/方案名 */
    columns: z
      .array(z.string().min(1, '表头不能为空').max(20, '表头过长（≤20 字）'))
      .min(2, '对比表格至少需要 2 列')
      .max(8, '对比表格列数过多（≤8）'),
    /** 行数据：2~20 行，每行单元格与列数严格对齐（空缺写「—」而不是留空/缺位） */
    rows: z
      .array(z.array(z.string().max(200, '单元格内容过长（≤200 字）')).min(1, '表格行不能为空'))
      .min(2, '对比表格至少需要 2 行')
      .max(20, '对比表格行数过多（≤20）'),
    /** 可选结论（如「综合推荐方案 B」），供前端在表格下方强调展示 */
    conclusion: z.string().max(300, '表格结论过长（≤300 字）').optional(),
  })
  // 行列对齐是「字段级格式契约」：缺位行无法渲染成合法表格，直接在 Schema 层拒绝
  .refine((table) => table.rows.every((row) => row.length === table.columns.length), {
    message: '表格每行单元格数必须与列数一致（空缺用「—」占位）',
  });
export type TableDraft = z.infer<typeof TableDraftSchema>;

// ---------------------------------------------------------------------------
// 清单：分组 + 可勾选项。owner/due 均为自由文本（会议记录里的责任人/截止时间天然不规范，强解析反而易错）
// ---------------------------------------------------------------------------

export const ChecklistItemSchema = z.object({
  text: z.string().min(1, '清单项内容不能为空').max(100, '清单项过长（≤100 字，一项一事）'),
  owner: z.string().max(30, '责任人过长（≤30 字）').optional(),
  due: z.string().max(30, '截止时间过长（≤30 字）').optional(),
});

export const ChecklistGroupSchema = z.object({
  title: z.string().min(1, '清单分组标题不能为空').max(40, '分组标题过长（≤40 字）'),
  items: z.array(ChecklistItemSchema).min(1, '清单分组至少 1 项').max(20, '单分组项数过多（≤20）'),
});

export const ChecklistDraftSchema = z.object({
  groups: z.array(ChecklistGroupSchema).min(1, '清单至少需要 1 个分组').max(10, '清单分组过多（≤10）'),
});
export type ChecklistDraft = z.infer<typeof ChecklistDraftSchema>;

// ---------------------------------------------------------------------------
// 时间线：按时间先后排列的事件。time 为自由文本（Day1 上午 / 09:00 / 第 3 周），
// 排序由模型按语义给出，前端按数组顺序渲染，不做时间解析（与 owner/due 同理：强解析易错）
// ---------------------------------------------------------------------------

export const TimelineEventSchema = z.object({
  time: z.string().min(1, '时间线事件必须有时间标记').max(30, '时间标记过长（≤30 字）'),
  title: z.string().min(1, '时间线事件标题不能为空').max(60, '事件标题过长（≤60 字）'),
  detail: z.string().max(200, '事件详情过长（≤200 字）').optional(),
});

export const TimelineDraftSchema = z.object({
  events: z.array(TimelineEventSchema).min(2, '时间线至少需要 2 个事件').max(30, '时间线事件过多（≤30）'),
});
export type TimelineDraft = z.infer<typeof TimelineDraftSchema>;

// ---------------------------------------------------------------------------
// generate 结果的多形态扩展：kind='generate' 的响应体按 artifactKind 携带对应 payload。
// 兼容性关键决策：flowchart 走原有 flowDraft 字段、artifactKind 缺省视为 flowchart，
// 旧响应（无 artifactKind、只有 flowDraft）依然合法——旧分享页/旧前端零影响。
// ---------------------------------------------------------------------------

/** 各形态在 generate 响应体中的字段名映射（graph 组装 result / service 还原候选时复用） */
export const ARTIFACT_PAYLOAD_FIELD: Record<ArtifactKind, string> = {
  flowchart: 'flowDraft',
  mindmap: 'mindmapDraft',
  table: 'tableDraft',
  checklist: 'checklistDraft',
  timeline: 'timelineDraft',
};

/** 四种新形态 payload 的判别联合（flowchart 复用既有 FlowDraft，不在此重复定义） */
export const NewArtifactPayloadSchema = z.union([MindMapDraftSchema, TableDraftSchema, ChecklistDraftSchema, TimelineDraftSchema]);
export type NewArtifactPayload = z.infer<typeof NewArtifactPayloadSchema>;

/** 按形态选择对应 Schema（graph 解析 LLM 输出时使用；flowchart 返回 null 表示走既有 FlowDraftSchema） */
export function artifactSchemaFor(kind: ArtifactKind): z.ZodTypeAny | null {
  switch (kind) {
    case 'mindmap':
      return MindMapDraftSchema;
    case 'table':
      return TableDraftSchema;
    case 'checklist':
      return ChecklistDraftSchema;
    case 'timeline':
      return TimelineDraftSchema;
    default:
      return null;
  }
}
