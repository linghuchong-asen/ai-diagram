/*
 * @Description: trace 埋点的公共类型与步骤名常量
 */

/** 轨迹步骤名(埋点覆盖:意图识别 / 形式路由 / 模型档位路由 / 上下文组装 / 工具调用 / 生成 / 反思) */
export const TRACE_STEPS = {
  INTENT: 'intent.recognize',
  /** competitor-driven-evolution-batch Round 14:generate 意图内的产物形态路由(形式路由) */
  FORM_ROUTE: 'form.route',
  /** model-routing-batch:生成档位路由(auto 复杂度路由 / 手选直通 / 试用强制) */
  MODEL_ROUTE: 'model.route',
  CONTEXT: 'context.build',
  TOOL_CALL: 'tool.call',
  GENERATE: 'llm.generate',
  CONSULT: 'llm.consult',
  REFLECTION: 'reflection.evaluate',
  REWRITE: 'reflection.rewrite',
  HUMAN_CONFIRM: 'human.confirm.suspend',
  PERSIST: 'memory.persist',
  RUN: 'graph.run',
} as const;

export type TraceStepName = (typeof TRACE_STEPS)[keyof typeof TRACE_STEPS];

export interface TokenUsageLike {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export interface TraceStepRecord {
  seq: number;
  stepName: string;
  status: 'ok' | 'fail' | 'skipped';
  inputSummary?: string;
  outputSummary?: string;
  durationMs: number;
  usage?: TokenUsageLike & { source?: 'actual' | 'estimate' };
  errorType?: string;
  errorSummary?: string;
  meta?: Record<string, any>;
  createTime?: Date;
}

export interface TraceMetrics {
  /** 工具调用次数 */
  toolCallCount: number;
  /** 工具调用成功次数 */
  toolCallOkCount: number;
  /** 工具调用成功率(0~1) */
  toolCallSuccessRate: number;
  /** 按工具名细分的调用次数 */
  toolCallsByName: Record<string, number>;
  /** 反思回路次数(reflection.evaluate 中判定不通过的次数) */
  reflectionLoopCount: number;
  /** 反思判定通过次数 */
  reflectionPassCount: number;
  /** 错误恢复步数:fail 步骤中其后仍有成功产出的次数(体现重试/修正生效) */
  errorRecoverySteps: number;
  /** LLM 生成调用次数 */
  llmCallCount: number;
  /** 上下文利用率:实际使用 token / 预算上限(0~1) */
  contextUtilization: number;
  /** 上下文预算上限(token) */
  contextBudget: number;
  /** 上下文实际 token 数 */
  contextTokens: number;
  /** 被裁剪的上下文区块 */
  contextTruncated: string[];
  /** 终止条件 */
  termination: TraceTermination;
  /** 步骤总数 */
  stepCount: number;
  /** 总耗时(ms) */
  totalDurationMs: number;
  /** 各步骤耗时占比(stepName -> ms) */
  durationByStep: Record<string, number>;
  /** token 总用量 */
  tokenUsage: TokenUsageLike;
}

export type TraceTermination =
  /** 模板命中短路 */
  | 'template_shortcut'
  /** 生成/修改通过校验 */
  | 'valid_result'
  /** 咨询直接回答 */
  | 'consult_answer'
  /** 转人在回路挂起 */
  | 'suspended_human_confirm'
  /** 异常终止 */
  | 'error'
  /** 轨迹未完成(进程中断或未收尾) */
  | 'incomplete';
