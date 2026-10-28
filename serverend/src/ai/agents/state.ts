// 语图技术方案 - Agent 状态定义
// LangGraph 状态图:意图识别 → 形式路由(generate) → 上下文组装 → 生成/修改 → 反思 → 工具
// multi-artifact-batch:generate 场景携带 artifactKind(产物形态)与 formHint(用户显式指定)
import { IntentType } from '../schemas/chat.schema';
import { FlowDraft } from '../schemas/flow-draft.schema';
import { ModifyPatchOutput } from '../schemas/patch.schema';
import { CanvasNode } from '../schemas/node.schema';
import { ArtifactKind } from '../schemas/artifact.schema';
import { ReflectionIssue } from '../reflection/evaluator';
import { HumanConfirmPayload } from '../reflection/rewriter';
import { IntentTokenUsage } from '../intent/intent.llm-classifier';
import { ToolResult } from '../tools/tool.types';
// model-routing-batch:模型档位路由的输入/产出类型
import type { ModelPreference } from '../schemas/chat.schema';
import type { GenerationTier } from '../adapters/llm.factory';
import type { ModelRouteSource } from './model-route';

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
  /** 用户显式指定的产物形态(multi-artifact-batch:前端 formHint 直传,优先级最高) */
  formHint?: ArtifactKind;
  /**
   * 会话内各形态累计产出次数(competitor-driven-evolution-batch Round 15)。
   * 由 AiService 进程内台账(createThread 时读出)传入;FormRouter 在规则歧义/未命中时
   * 若某形态 ≥2 次且严格最多则直接采信(会话偏好),绝不覆盖 formHint。
   */
  sessionFormUsage?: Partial<Record<ArtifactKind, number>>;
  /** generate 意图下的产物形态(multi-artifact-batch:FormRouter 路由结果;undefined 视为 flowchart) */
  artifactKind?: ArtifactKind;
  /** 形态路由来源 hint/rule/llm/default(观测字段) */
  artifactSource?: 'hint' | 'rule' | 'llm' | 'default';
  /** 形态路由理由链(观测字段) */
  artifactReasons?: string[];

  // 模型档位路由(model-routing-batch)
  /** 用户模型偏好(手选直通;缺省 = auto 智能路由) */
  modelPreference?: ModelPreference;
  /** 是否会员(手选旗舰的门槛;Auto 路由不受限) */
  isVip?: boolean;
  /** 复杂度结论(简单/复杂;来源见 complexitySource) */
  complexity?: 'simple' | 'complex';
  /** 复杂度结论来源(观测字段) */
  complexitySource?: 'rule' | 'llm' | 'default';
  /** 生成档位路由结果(generate/modify 主生成消费;consult 不经过路由) */
  modelTier?: GenerationTier;
  /** 档位路由来源(观测字段;'escalate' 表示轻量档反思失败后末次重试升级旗舰) */
  modelTierSource?: ModelRouteSource | 'escalate';
  /** 档位路由理由链(观测字段) */
  modelTierReasons?: string[];
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
  /** 非 flowchart 形态解析后的产物(multi-artifact-batch;flowchart 仍用 draft) */
  artifact?: unknown;
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
    // multi-artifact-batch:formHint 直传;artifactKind 恢复执行(人在回路 retry)时预置,跳过二次路由
    formHint: input.formHint,
    artifactKind: input.artifactKind,
    // model-routing-batch:模型偏好/会员态直传;modelTier 恢复执行时预置则跳过二次路由
    modelPreference: input.modelPreference,
    isVip: input.isVip,
    modelTier: input.modelTier,
    // competitor-driven-evolution-batch Round 15:会话形态偏好(FormRouter 规则歧义时兜底采信)
    sessionFormUsage: input.sessionFormUsage,
    needHumanConfirm: input.needHumanConfirm,
    confirmPayload: input.confirmPayload,
    resumeToken: input.resumeToken,
    suspended: input.suspended,
    resumeInstruction: input.resumeInstruction,
    rewriteCount: input.rewriteCount ?? 0,
    maxRewrites: input.maxRewrites ?? 2,
  };
}

