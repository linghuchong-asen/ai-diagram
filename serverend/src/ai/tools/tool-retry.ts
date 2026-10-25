// 语图技术方案 - 工具失败分级重试(Task 8.3)
// 三级策略:
//   network → 代码层指数退避重试(200 / 400 / 800ms,最多 3 次),对模型透明;
//   param   → 不在这里重试:结构化错误摘要回传模型,由模型自修正(最多 3 次,由上层编排计数);
//   fail    → 不重试:直接走受控降级话术(prompts/fallback.prompt.ts)。
// 本文件只提供「代码层退避」这一种纯函数能力,便于单测与复用。
import { StructuredToolError, ToolErrorClassifier } from './error.classifier';

export interface RetryOptions {
  /** 最大尝试次数(含首次),默认 3 */
  maxAttempts?: number;
  /** 首次退避时长,默认 200ms(序列 200 / 400 / 800) */
  baseDelayMs?: number;
  /** 是否可重试的判定;默认只对 network 类错误重试 */
  shouldRetry?: (error: StructuredToolError, attempt: number) => boolean;
  /** 每次退避前的回调(用于日志/埋点) */
  onRetry?: (info: { attempt: number; delayMs: number; error: StructuredToolError }) => void;
  /** 测试注入:替换 sleep */
  sleep?: (ms: number) => Promise<void>;
}

export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_BASE_DELAY_MS = 200;

/** 指数退避序列:200 → 400 → 800 */
export function backoffDelay(attempt: number, baseDelayMs: number = DEFAULT_BASE_DELAY_MS): number {
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 代码层重试包装:只有「network 类」错误才重试;其余错误立即抛出最后一次异常。
 * @param task 实际工具调用
 * @param classify 异常 → 结构化错误(默认用 ToolErrorClassifier)
 */
export async function retryWithBackoff<T>(
  task: () => Promise<T>,
  options: RetryOptions = {},
  classify: (err: unknown) => StructuredToolError = (err) => new ToolErrorClassifier().classify(err),
): Promise<{ ok: true; value: T } | { ok: false; error: StructuredToolError; attempts: number }> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const sleep = options.sleep ?? defaultSleep;
  const shouldRetry = options.shouldRetry ?? ((e) => e.error_type === 'network');

  let lastError: StructuredToolError = {
    status: 'error',
    error_type: 'fail',
    message_for_llm: '工具执行失败(未知原因)',
    suggestion: 'fallback',
  };

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return { ok: true, value: await task() };
    } catch (err) {
      lastError = classify(err);
      const canRetry = attempt < maxAttempts && shouldRetry(lastError, attempt);
      if (!canRetry) break;
      const delayMs = backoffDelay(attempt, baseDelayMs);
      options.onRetry?.({ attempt, delayMs, error: lastError });
      await sleep(delayMs);
    }
  }

  return { ok: false, error: lastError, attempts: maxAttempts };
}
