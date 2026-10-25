/*
 * @Description: trace 摘要与脱敏工具(纯函数，便于单测)
 * 异常文本统一复用 src/ai/tools/error-sanitizer.ts，避免在观测层重新实现脱敏规则。
 */
import { sanitizeForLlm, sanitizeText } from '../ai/tools/error-sanitizer';
import { TokenUsageLike } from './trace.types';

/** 默认摘要长度上限(字符) */
export const TRACE_SUMMARY_MAX_LEN = 300;

/** 轨迹保留的最大天数(清理用) */
export const TRACE_RETENTION_DAYS = 14;
/** 单个 thread 保留的最大步骤数(防无界增长) */
export const TRACE_MAX_STEPS_PER_THREAD = 200;

/**
 * 生成步骤输入/输出摘要：结构化对象转 JSON 再截断，字符串做空白折叠。
 * 任何异常都退化为 '[unserializable]'，埋点本身绝不能抛错影响主链路。
 */
export function summarize(value: unknown, maxLen = TRACE_SUMMARY_MAX_LEN): string {
  if (value === undefined || value === null) return '';
  try {
    let text: string;
    if (typeof value === 'string') {
      text = value;
    } else {
      text = JSON.stringify(value, replacer);
    }
    if (!text) return '';
    text = sanitizeText(text);
    return text.length > maxLen ? `${text.slice(0, maxLen)}…` : text;
  } catch {
    return '[unserializable]';
  }
}

/** JSON.stringify 的循环引用保护 */
function replacer(this: any, _key: string, val: unknown) {
  if (val instanceof Error) {
    return { name: val.name, message: val.message };
  }
  return val;
}

/** 异常摘要：复用 error-sanitizer 的脱敏实现，不重复定义敏感信息规则 */
export function summarizeError(err: unknown): string {
  return sanitizeForLlm(err);
}

/** token 用量归一化:缺字段补 0，并保证 totalTokens 不小于分项之和 */
export function normalizeUsage(usage?: TokenUsageLike | null): Required<TokenUsageLike> {
  const prompt = toInt(usage?.promptTokens);
  const completion = toInt(usage?.completionTokens);
  const total = Math.max(toInt(usage?.totalTokens), prompt + completion);
  return { promptTokens: prompt, completionTokens: completion, totalTokens: total };
}

/** 按字符估算 token(与 TokenBudget.estimate 口径一致:中文约 1 字符 ≈ 1 token) */
export function estimateUsage(text: unknown): Required<TokenUsageLike> & { source: 'estimate' } {
  const len = typeof text === 'string' ? text.length : summarize(text, 100000).length;
  return {
    promptTokens: 0,
    completionTokens: Math.ceil(len),
    totalTokens: Math.ceil(len),
    source: 'estimate',
  };
}

function toInt(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}
