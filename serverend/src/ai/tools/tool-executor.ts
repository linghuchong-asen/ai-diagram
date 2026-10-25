// 语图技术方案 - 工具统一出口(Task 8.2 / 8.3 / 8.5)
// 这是「所有工具调用的唯一入口」,上层(graph.ts)只与本文件交互。职责:
//   1) 白名单校验:未登记工具直接拒绝(不给模型自由调用外部能力的口子);
//   2) 参数 zod 校验:交由 Registry 的 paramsSchema 完成,失败归类 param;
//   3) 失败分级重试:
//        network → 代码层指数退避(200/400/800ms,最多 3 次),对模型透明;
//        param   → 不在此重试:返回结构化错误摘要,由模型自修正(上层计数 ≤3 次);
//        fail    → 不重试:返回受控降级话术;
//   4) 结果封顶:数组 top-K=5、对象字段白名单、字符串 2000 字符截断并注明;
//   5) 归一化:统一产出 ToolResult;
//   6) 多轮上下文:contextId 由 ToolContextStore 承载(有界 LRU + TTL)。
import { Injectable, Logger } from '@nestjs/common';
import { ToolRegistry } from './tool.registry';
import { ToolContextStore } from './tool-context.store';
import {
  failResult,
  okResult,
  ToolResult,
  ToolUsage,
  TOOL_RESULT_MAX_DEPTH,
  TOOL_RESULT_MAX_STRING_LEN,
  TOOL_RESULT_TOP_K,
} from './tool.types';
import { StructuredToolError, ToolErrorClassifier } from './error.classifier';
import { sanitizeForLlm, sanitizeText } from './error-sanitizer';
import { backoffDelay, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS } from './tool-retry';
import { PARAM_CORRECTION_HINT, buildToolDegradeMessage } from '../prompts/fallback.prompt';

/** 各工具允许回传给模型的字段白名单(超出字段直接丢弃) */
export const TOOL_DATA_FIELD_WHITELIST: Record<string, string[]> = {
  template_match: ['matched', 'templateId', 'templateName', 'draft'],
  validate_graph: ['valid', 'issues'],
};

export interface ToolExecuteOptions {
  /** 工具名(必须在白名单内) */
  name: string;
  /** 参数(未校验) */
  params: Record<string, unknown>;
  /** 所属线程 */
  threadId?: string;
  /** 多轮上下文 id;不传则由 executor 生成 */
  contextId?: string;
  /** param 类错误的模型自修正剩余次数(由上层编排传入,默认 3) */
  modelCorrectionBudget?: number;
  /** network 类错误的代码层最大尝试次数(默认 3) */
  maxAttempts?: number;
  /** 退避基数(默认 200ms → 200/400/800) */
  baseDelayMs?: number;
  /** 测试注入:替换 sleep */
  sleep?: (ms: number) => Promise<void>;
  /** 原始调用文本(便于日志定位) */
  raw?: string;
}

@Injectable()
export class ToolExecutor {
  private readonly logger = new Logger(ToolExecutor.name);
  private readonly classifier = new ToolErrorClassifier();

  constructor(
    private readonly registry: ToolRegistry,
    private readonly contextStore: ToolContextStore,
  ) {}

  /** 白名单(只读透出,便于日志与断言) */
  get whitelist(): string[] {
    return this.registry.whitelist;
  }

  /** 统一出口:执行工具并返回归一化结果 */
  async execute(options: ToolExecuteOptions): Promise<ToolResult> {
    const { name, params, threadId, raw = '' } = options;
    const contextId = options.contextId ?? this.nextContextId(threadId);
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
    const sleep = options.sleep ?? defaultSleep;

    // ---- 1) 白名单校验 ----
    if (!this.registry.has(name)) {
      this.logger.warn(`拒绝调用未登记工具: ${name}(白名单: ${this.whitelist.join(', ')})`);
      return failResult(
        name,
        `工具 ${name} 不在可用白名单内,请改用: ${this.whitelist.join(' / ')};若都不适用,直接基于用户描述生成。`,
        'fail',
        { contextId },
      );
    }

    // ---- 2)+3) 执行与失败分级重试 ----
    let attempt = 0;
    let lastError: StructuredToolError | undefined;
    let data: unknown;
    let succeeded = false;

    while (attempt < maxAttempts) {
      attempt += 1;
      const result = await this.registry.execute({ name, params, raw, contextId, threadId });

      if (result.ok) {
        data = result.data;
        succeeded = true;
        break;
      }

      lastError = result.error;
      const errorType = lastError?.error_type ?? 'fail';

      // param:不在代码层重试 —— 回传结构化摘要让模型自修正(计数由上层持有)
      if (errorType === 'param') {
        this.logger.warn(`工具 ${name} 参数错误(第 ${attempt} 次): ${lastError?.message_for_llm}`);
        return failResult(name, this.buildParamCorrectionMessage(lastError!), errorType, {
          contextId,
        });
      }

      // fail:直接降级,不做无谓重试
      if (errorType !== 'network') break;

      // network:代码层指数退避重试,对模型透明
      if (attempt < maxAttempts) {
        const delayMs = backoffDelay(attempt, baseDelayMs);
        this.logger.warn(`工具 ${name} 网络类失败,${delayMs}ms 后重试(第 ${attempt}/${maxAttempts} 次)`);
        await sleep(delayMs);
        continue;
      }
    }

    // ---- 4)+5) 成功:结果封顶 + 归一化 + 上下文写入 ----
    if (succeeded) {
      const capped = capResult(data, name);
      // 多轮上下文由 Executor 统一负责写入(Registry 保持只读,便于替换实现)
      if (contextId) {
        this.contextStore.set({ contextId, threadId, tool: name, payload: capped });
      }
      this.logger.log(`工具调用成功: ${name}(attempt=${attempt}, contextId=${contextId})`);
      return okResult(name, capped, this.buildSuccessMessage(name, capped), {
        contextId,
        usage: this.collectUsage(capped),
      });
    }

    // ---- 重试耗尽 / fail:受控降级话术 ----
    const reason = sanitizeForLlm(lastError?.message_for_llm ?? '未知错误');
    this.logger.error(`工具 ${name} 调用失败(error_type=${lastError?.error_type ?? 'fail'}, attempts=${attempt}): ${reason}`);
    return failResult(name, buildToolDegradeMessage(name, reason), lastError?.error_type ?? 'fail', {
      contextId,
    });
  }

  /** 结束一个 thread 时清理其工具上下文(避免长期驻留) */
  releaseThread(threadId: string): void {
    this.contextStore.deleteByThread(threadId);
  }

  /** 生成 contextId:thread 维度可追溯 */
  private nextContextId(threadId?: string): string {
    const seq = Math.random().toString(36).slice(2, 8);
    return `ctx_${threadId ? `${threadId.slice(0, 8)}_` : ''}${Date.now().toString(36)}_${seq}`;
  }

  /** param 错误的模型自修正提示(结构化摘要 + 固定引导语) */
  private buildParamCorrectionMessage(error: StructuredToolError): string {
    return `${PARAM_CORRECTION_HINT}\n错误摘要: ${sanitizeText(error.message_for_llm)}`;
  }

  /** 成功摘要:告诉模型「拿到了什么、怎么用」 */
  private buildSuccessMessage(tool: string, data: unknown): string {
    if (tool === 'template_match') {
      const matched = (data as any)?.matched === true;
      return matched
        ? `已命中内置模板「${(data as any)?.templateName ?? ''}」(id=${(data as any)?.templateId ?? ''}),可直接使用 data.draft 作为流程结构,无需再自行生成节点。`
        : '未命中内置模板,请基于用户描述自行生成流程结构。';
    }
    if (tool === 'validate_graph') {
      const valid = (data as any)?.valid === true;
      const count = Array.isArray((data as any)?.issues) ? (data as any).issues.length : 0;
      return valid ? `校验通过(共 ${count} 条提示)。` : `校验未通过,共 ${count} 条问题,请按 issues 中的 message 做最小改动修正。`;
    }
    return `工具 ${tool} 执行成功,结果已做字段白名单与长度封顶。`;
  }

  /** 用量观测:工具本身不计费(纯本地程序),仅记录调用次数 */
  private collectUsage(data: unknown): ToolUsage | undefined {
    const usage = (data as any)?.usage;
    if (usage && typeof usage === 'object') return usage as ToolUsage;
    return { calls: 1 };
  }
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * 结果封顶(Task 8.2):防止工具产出把上下文撑爆。
 *  - 数组:只保留前 TOP_K=5 项,并在同级附上被截断的说明;
 *  - 对象:按工具白名单保留字段(白名单未登记的工具保留全部标量字段);
 *  - 字符串:超过 2000 字符截断并注明;
 *  - 深度:超过 4 层以 "[depth-limited]" 占位。
 */
export function capResult(input: unknown, tool?: string, depth = 0): unknown {
  if (depth > TOOL_RESULT_MAX_DEPTH) return '[depth-limited]';
  if (input === null || input === undefined) return input;

  if (typeof input === 'string') {
    return input.length > TOOL_RESULT_MAX_STRING_LEN
      ? `${input.slice(0, TOOL_RESULT_MAX_STRING_LEN)}…[truncated ${input.length - TOOL_RESULT_MAX_STRING_LEN} chars]`
      : input;
  }

  if (Array.isArray(input)) {
    const kept = input.slice(0, TOOL_RESULT_TOP_K).map((item) => capResult(item, tool, depth + 1));
    if (input.length <= TOOL_RESULT_TOP_K) return kept;
    // 数组截断需要让模型知道「还有更多」,否则可能误判数据完整性
    return [...kept, `[capped: 共 ${input.length} 项,仅返回前 ${TOOL_RESULT_TOP_K} 项]`];
  }

  if (typeof input === 'object') {
    const source = input as Record<string, unknown>;
    const allowed = tool ? TOOL_DATA_FIELD_WHITELIST[tool] : undefined;
    const keys = allowed ? Object.keys(source).filter((k) => allowed.includes(k)) : Object.keys(source);
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      out[key] = capResult(source[key], undefined, depth + 1);
    }
    return out;
  }

  return input;
}
