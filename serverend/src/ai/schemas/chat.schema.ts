// 语图技术方案 - 聊天/流式接口契约
// 采用「思考流式 + 数据一次性」:
//   1. POST /api/ai/chat -> { threadId }(立即返回,后台跑 LangGraph)
//   2. SSE  /api/ai/think/:threadId -> 逐 token 推送思考过程
//   3. GET  /api/ai/result/:threadId -> 202 + Retry-After 轮询,就绪返回完整数据
import { z } from 'zod';

// 意图类型
export const INTENT_TYPES = ['generate', 'modify', 'consult'] as const;
export type IntentType = (typeof INTENT_TYPES)[number];

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
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// Task 3 免登录单次试用请求体:trialId 为前端 localStorage 生成的匿名身份标识(≤64 字),
// message 较登录链路更短(≤500 字,控制匿名成本);校验失败由 controller 转 400。
export const TrialChatRequestSchema = z.object({
  message: z.string().min(1, '消息不能为空').max(500, '消息过长(试用最多 500 字)'),
  trialId: z.string().min(1, 'trialId 不能为空').max(64, 'trialId 过长(最多 64 字)'),
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
export const GenerateResultSchema = z.object({
  kind: z.literal('generate'),
  flowDraft: z.object({
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
  }),
  notice: z.string().optional(),
});

export const ModifyResultSchema = z.object({
  kind: z.literal('modify'),
  operations: z.array(z.record(z.string(), z.any())),
  notice: z.string().optional(),
});

export const ConsultResultSchema = z.object({
  kind: z.literal('consult'),
  answer: z.string(),
  notice: z.string().optional(),
});

export type AiResult =
  | z.infer<typeof GenerateResultSchema>
  | z.infer<typeof ModifyResultSchema>
  | z.infer<typeof ConsultResultSchema>;
