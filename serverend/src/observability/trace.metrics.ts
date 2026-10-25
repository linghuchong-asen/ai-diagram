/*
 * @Description: 轨迹指标聚合(13.2) —— 纯函数，由 trace 步骤列表计算，便于单测与离线评估复用
 * 指标口径:
 *   - 工具调用次数/成功率:统计 stepName = tool.call 的步骤
 *   - 反思回路次数:reflection.evaluate 步骤中 meta.passed = false 的次数
 *   - 错误恢复步数:fail 步骤之后同一 thread 内仍出现 ok 步骤的次数(体现重试/修正生效)
 *   - 上下文利用率:context.build 步骤记录的 tokenCount / contextBudget
 *   - 终止条件:优先看 header.status，其次看最后一个业务步骤的语义
 */
import {
  TraceMetrics,
  TraceStepRecord,
  TraceTermination,
  TokenUsageLike,
} from './trace.types';
import { TRACE_STEPS } from './trace.types';

/** 上下文预算上限:与 ContextBuilder 使用的 TokenBudget(32000 * 0.8) 保持一致 */
export const CONTEXT_TOKEN_BUDGET = 25600;

export interface MetricsInput {
  steps: TraceStepRecord[];
  status?: 'running' | 'ok' | 'suspended' | 'error';
  resultKind?: string;
  templateMatched?: boolean;
  totalDurationMs?: number;
  contextBudget?: number;
}

/** 由轨迹步骤聚合指标 */
export function computeTraceMetrics(input: MetricsInput): TraceMetrics {
  const steps = (input?.steps ?? []).slice().sort((a, b) => a.seq - b.seq);
  const budget = input?.contextBudget ?? CONTEXT_TOKEN_BUDGET;

  const toolSteps = steps.filter((s) => s.stepName === TRACE_STEPS.TOOL_CALL);
  const toolCallOkCount = toolSteps.filter((s) => s.status === 'ok').length;

  const toolCallsByName: Record<string, number> = {};
  for (const step of toolSteps) {
    const name = String(step.meta?.tool ?? 'unknown');
    toolCallsByName[name] = (toolCallsByName[name] ?? 0) + 1;
  }

  const reflectionSteps = steps.filter((s) => s.stepName === TRACE_STEPS.REFLECTION);
  const reflectionPassCount = reflectionSteps.filter((s) => s.status === 'ok').length;
  const reflectionLoopCount = reflectionSteps.length - reflectionPassCount;

  const llmCallCount = steps.filter(
    (s) => s.stepName === TRACE_STEPS.GENERATE || s.stepName === TRACE_STEPS.CONSULT,
  ).length;

  /* 错误恢复步数:某个 fail 步骤之后是否还有 ok 步骤(说明重试/修正后链路恢复) */
  let errorRecoverySteps = 0;
  for (let i = 0; i < steps.length; i++) {
    if (steps[i].status !== 'fail') continue;
    const recovered = steps.slice(i + 1).some((s) => s.status === 'ok');
    if (recovered) errorRecoverySteps++;
  }

  const contextStep = steps.filter((s) => s.stepName === TRACE_STEPS.CONTEXT).pop();
  const contextTokens = toInt(contextStep?.meta?.tokenCount);
  const contextTruncated: string[] = Array.isArray(contextStep?.meta?.truncated)
    ? contextStep!.meta!.truncated.map((item: unknown) => String(item))
    : [];
  const contextUtilization =
    budget > 0 ? round(Math.min(contextTokens / budget, 1)) : 0;

  const durationByStep: Record<string, number> = {};
  const tokenUsage: Required<TokenUsageLike> = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };
  for (const step of steps) {
    durationByStep[step.stepName] = (durationByStep[step.stepName] ?? 0) + toInt(step.durationMs);
    tokenUsage.promptTokens += toInt(step.usage?.promptTokens);
    tokenUsage.completionTokens += toInt(step.usage?.completionTokens);
    tokenUsage.totalTokens += toInt(step.usage?.totalTokens);
  }

  const totalDurationMs =
    toInt(input?.totalDurationMs) ||
    steps.reduce((acc, step) => acc + toInt(step.durationMs), 0);

  return {
    toolCallCount: toolSteps.length,
    toolCallOkCount,
    toolCallSuccessRate: toolSteps.length
      ? round(toolCallOkCount / toolSteps.length)
      : 1,
    toolCallsByName,
    reflectionLoopCount,
    reflectionPassCount,
    errorRecoverySteps,
    llmCallCount,
    contextUtilization,
    contextBudget: budget,
    contextTokens,
    contextTruncated,
    termination: resolveTermination(input, steps),
    stepCount: steps.length,
    totalDurationMs,
    durationByStep,
    tokenUsage,
  };
}

/** 终止条件判定 */
export function resolveTermination(
  input: MetricsInput,
  steps: TraceStepRecord[],
): TraceTermination {
  if (input?.status === 'error') return 'error';
  if (input?.status === 'suspended') return 'suspended_human_confirm';
  if (input?.templateMatched) return 'template_shortcut';
  if (input?.status === 'ok') {
    if (input?.resultKind === 'consult') return 'consult_answer';
    if (input?.resultKind === 'generate' || input?.resultKind === 'modify') {
      return 'valid_result';
    }
    return 'consult_answer';
  }
  /* 轨迹未收尾:看最后一步语义推断 */
  const last = steps[steps.length - 1];
  if (last?.stepName === TRACE_STEPS.HUMAN_CONFIRM) return 'suspended_human_confirm';
  if (last?.status === 'fail') return 'error';
  return 'incomplete';
}

function toInt(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
