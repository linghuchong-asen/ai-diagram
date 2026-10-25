// 语图技术方案 - Agent 状态定义
// LangGraph 状态图:意图识别 → 上下文组装 → 生成/修改 → 反思 → 工具
import { IntentType } from '../schemas/chat.schema';
import { FlowDraft } from '../schemas/flow-draft.schema';
import { ModifyPatchOutput } from '../schemas/patch.schema';
import { CanvasNode } from '../schemas/node.schema';
import { ReflectionIssue } from '../reflection/evaluator';
import { HumanConfirmPayload } from '../reflection/rewriter';
import { IntentTokenUsage } from '../intent/intent.llm-classifier';
import { ToolResult } from '../tools/tool.types';

export interface AgentState {
  // 输入
  threadId: string;
  sessionId?: string;
  projectId?: string;
  /** 发起用户 id(命名空间隔离:用户画像按 user_id,长期记忆按 project_id) */
  userId?: string;
  /** 免登录试用身份(Task 3):匿名生成完成的增长埋点携带 trialId */
  trialId?: string;
  query: string;
  canvas?: CanvasNode[];

  // 意图与上下文
  intent?: IntentType;
  /** 意图来源:'rule' = 规则命中;'llm' = 规则未命中/歧义后由模型兜底(Task 7.3) */
  intentSource?: 'rule' | 'llm';
  /** 意图识别置信度 */
  intentConfidence?: number;
  /** 意图识别理由链(便于排查规则/模型分歧) */
  intentReasons?: string[];
  /** 模型兜底产生的 token 用量(Task 7.3) */
  intentUsage?: IntentTokenUsage;
  contextText?: string;
  contextTruncated?: string[];
  /** 各分段实际占用/上限(上下文预算观测,Task 10.4) */
  contextSegments?: Record<string, { used: number; limit: number }>;
  /** 记忆检索降级原因(embedding/rerank 不可用时记录,Task 10.2) */
  memoryDegraded?: Array<{ stage: string; reason: string }>;
  /** 本轮是否检测到话题切换(Task 10.5) */
  topicShifted?: boolean;
  /** Prompt 注入过滤命中的模式名(Task 11.6,观测用) */
  injectionHits?: string[];

  // 生成结果(原始 LLM 输出与解析后结构)
  rawOutput?: string;
  draft?: FlowDraft;
  patch?: ModifyPatchOutput;
  consultAnswer?: string;

  // 反思
  reflectionValid?: boolean;
  reflectionIssues?: ReflectionIssue[];
  rewriteCount: number;
  maxRewrites: number;

  // 工具(经 ToolExecutor 归一化后的结果,便于日志与前端排障)
  toolResult?: ToolResult;
  toolCalls?: Array<{ tool: string; status: 'ok' | 'fail'; error_type?: string; contextId?: string }>;
  templateMatched?: boolean;

  // 人在回路(Task 9.2 / 9.5):反思修正超限后挂起,等待前端确认
  /** 是否需要用户确认(true 时本次执行挂起,不产出最终 result) */
  needHumanConfirm?: boolean;
  /** 挂起时下发的确认载荷(reason + issue 列表 + 候选修正方案) */
  confirmPayload?: HumanConfirmPayload;
  /** 恢复执行令牌:防止前端重复/越权提交确认 */
  resumeToken?: string;
  /** 已挂起(等待确认中) */
  suspended?: boolean;
  /** 恢复执行时前端补充的约束指令 */
  resumeInstruction?: string;

  // 输出
  result?: unknown;
  error?: string;
}

export function createInitialState(input: Partial<AgentState>): AgentState {
  return {
    threadId: input.threadId ?? '',
    sessionId: input.sessionId,
    projectId: input.projectId,
    userId: input.userId,
    trialId: input.trialId,
    query: input.query ?? '',
    canvas: input.canvas,
    // Task 3 免登录试用:startTrial 可预置意图(强制 generate),graph 检测到后跳过意图识别
    intent: input.intent,
    intentSource: input.intentSource,
    needHumanConfirm: input.needHumanConfirm,
    confirmPayload: input.confirmPayload,
    resumeToken: input.resumeToken,
    suspended: input.suspended,
    resumeInstruction: input.resumeInstruction,
    rewriteCount: input.rewriteCount ?? 0,
    maxRewrites: input.maxRewrites ?? 2,
  };
}

