// 语图技术方案 - 聊天/流式接口契约
// 采用「思考流式 + 数据一次性」:
//   1. POST /api/ai/chat -> { threadId }(立即返回,后台跑 LangGraph)
//   2. SSE  /api/ai/think/:threadId -> 逐 token 推送思考过程
//   3. GET  /api/ai/result/:threadId -> 202 + Retry-After 轮询,就绪返回完整数据
// multi-artifact-batch:请求体新增可选 formHint(产物形态白名单);generate 响应按 artifactKind
//   携带 mindmapDraft/tableDraft/checklistDraft/timelineDraft(缺省 flowchart 兼容旧结构,见 artifact.schema.ts)
import { z } from 'zod';
// 多形态产物（multi-artifact-batch）：formHint 白名单与各形态 Draft Schema 统一从 artifact.schema 出
import {
  ArtifactFormHintSchema,
  MindMapDraftSchema,
  TableDraftSchema,
  ChecklistDraftSchema,
  TimelineDraftSchema,
} from './artifact.schema';

// 意图类型
export const INTENT_TYPES = ['generate', 'modify', 'consult'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

// 模型偏好(model-routing-batch):Trae 式模型选择 —— auto=智能路由(默认),
// flagship=旗舰模型(会员可手选),flash=轻量快速(所有用户可手选)。
// 登录链路白名单校验;试用链路不接收该字段(后端强制 flash 控成本)。
export const MODEL_PREFERENCES = ['auto', 'flagship', 'flash'] as const;
export type ModelPreference = (typeof MODEL_PREFERENCES)[number];

export const ModelPreferenceSchema = z.enum(MODEL_PREFERENCES);

// Chat 请求体
export const ChatRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(2000, '消息过长'),
  // 画布语义摘要:仅包含 id/label/type;modify 场景必填
  canvas: z
    .array(
      z.object({
        id: z.string(),
        label: z.string(),
        type: z.enum(['start', 'end', 'process', 'decision', 'io', 'subprocess']),
      }),
    )
    .optional(),
  sessionId: z.string().optional(),
  projectId: z.string().optional(),
  /**
   * 产物形态提示（multi-artifact-batch）：用户显式指定产物形态（前端快捷 chips 使用）。
   * 优先级最高——FormRouter 检测到 formHint 时跳过规则与 LLM 路由;白名单外的值由校验层直接 400。
   */
  formHint: ArtifactFormHintSchema.optional(),
  /**
   * 模型偏好(model-routing-batch):用户显式选择具体模型档位时直通该档;
   * 缺省/auto 时由复杂度路由决定(规则优先 → 意图模型兜底顺带输出 → 保守默认旗舰)。
   */
  modelPreference: ModelPreferenceSchema.optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Task 3 免登录单次试用请求体:trialId 为前端 localStorage 生成的匿名身份标识(≤64 字),
// message 较登录链路更短(≤500 字,控制匿名成本);校验失败由 controller 转 400。
export const TrialChatRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(500, '消息过长(试用最多 500 字)'),
  trialId: z.string().min(1, 'trialId 不能为空').max(64, 'trialId 过长(最多 64 字)'),
  // 产物形态提示与登录链路同构（试用页与编辑器共用浮窗,快捷 chips 同样生效）
  formHint: ArtifactFormHintSchema.optional(),
});

export type TrialChatRequest = z.infer<typeof TrialChatRequestSchema>;

// Chat 响应:立即返回 threadId
export const ChatResponseSchema = z.object({
  threadId: z.string(),
  intent: z.enum(INTENT_TYPES).optional(),
});

export type ChatResponse = z.infer<typeof ChatResponseSchema>;

// SSE 思考事件
export type ThinkSseEvent =
  | { type: 'thinking'; data: { token: string } }
  | { type: 'done'; data: { threadId: string } }
  | { type: 'error'; data: { message: string } };

// Result 响应(就绪后一次性返回)
// notice:会话级软上限提示字段(Task 11.5)——接近会话 token 软上限时由服务端附加,前端只读展示
// multi-artifact-batch:generate 分支按 artifactKind 携带对应 payload;缺省 artifactKind 视为 flowchart
// (向后兼容:旧响应/旧前端/旧分享只认 flowDraft,行为零变化)
export const GenerateResultSchema = z
  .object({
    kind: z.literal('generate'),
    /** 产物形态;缺省 = flowchart(兼容历史响应) */
    artifactKind: z.enum(['flowchart', 'mindmap', 'table', 'checklist', 'timeline']).optional(),
    /** 实际使用的生成档位(model-routing-batch 观测字段;flagship/flash) */
    routedModel: z.string().optional(),
    flowDraft: z
      .object({
        nodes: z.array(
          z.object({ id: z.string(), label: z.string(), type: z.string() }),
        ),
        edges: z.array(
          z.object({
            id: z.string(),
            source: z.string(),
            target: z.string(),
            label: z.string().optional(),
          }),
        ),
      })
      .optional(),
    mindmapDraft: MindMapDraftSchema.optional(),
    tableDraft: TableDraftSchema.optional(),
    checklistDraft: ChecklistDraftSchema.optional(),
    timelineDraft: TimelineDraftSchema.optional(),
    notice: z.string().optional(),
  })
  // 跨字段契约:artifactKind 与 payload 必须配对(flowchart→flowDraft,其余同理)
  .superRefine((value, ctx) => {
    const kind = value.artifactKind ?? 'flowchart';
    const fieldMap: Record<string, unknown> = {
      flowchart: value.flowDraft,
      mindmap: value.mindmapDraft,
      table: value.tableDraft,
      checklist: value.checklistDraft,
      timeline: value.timelineDraft,
    };
    if (!fieldMap[kind]) {
      const missingField = kind === 'flowchart' ? 'flowDraft' : `${kind}Draft`;
      ctx.addIssue({
        code: 'custom',
        path: [missingField],
        message: `artifactKind=${kind} 但响应缺少对应 payload 字段(${missingField})`,
      });
    }
  });

export const ModifyResultSchema = z.object({
  kind: z.literal('modify'),
  operations: z.array(z.record(z.string(), z.any())),
  notice: z.string().optional(),
  /** 实际使用的生成档位(model-routing-batch 观测字段) */
  routedModel: z.string().optional(),
});

export const ConsultResultSchema = z.object({
  kind: z.literal('consult'),
  answer: z.string(),
  notice: z.string().optional(),
  /** consult 固定走 medium 档,此字段仅作对齐(值为 'medium') */
  routedModel: z.string().optional(),
});

export type AiResult =
  | z.infer<typeof GenerateResultSchema>
  | z.infer<typeof ModifyResultSchema>
  | z.infer<typeof ConsultResultSchema>;
