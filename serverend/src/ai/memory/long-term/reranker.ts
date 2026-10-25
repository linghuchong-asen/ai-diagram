// 语图技术方案 - 记忆重排器(Reranker)
// 文档(memory.md):双路召回 → RRF 融合取 top-10 → Reranker 取 top-3。
// 实现:无 cross-encoder 依赖(不引入新基础设施),用中模型做 listwise 排序;
//       LLM 不可用/超时/输出非法时返回 null,由 LongTermMemoryService 退化为 RRF 序。
import { Injectable, Logger } from '@nestjs/common';
import { LlmFactory } from '../../adapters/llm.factory';
import { MemoryRecord, MemoryReranker } from './long-term.store';
import { RERANK_TOP_N } from './rrf';

/** 重排超时:旁路能力,不允许拖慢主链路 */
const RERANK_TIMEOUT_MS = 6000;
/** 单条候选送入重排的最大字符数 */
const RERANK_ITEM_MAX_CHARS = 400;

const RERANK_PROMPT = `你是检索重排器。给定用户查询与候选记忆列表,请按"对回答该查询的帮助程度"从高到低排序。
只输出 JSON 数组,元素为候选的 id 字符串,不要输出解释。最多输出 {topN} 个 id。

用户查询:
{query}

候选记忆:
{items}`;

@Injectable()
export class LlmMemoryReranker implements MemoryReranker {
  private readonly logger = new Logger(LlmMemoryReranker.name);

  constructor(private readonly llmFactory: LlmFactory) {}

  unavailableReason(): string | null {
    return this.llmFactory.isAvailable() ? null : this.llmFactory.getUnavailableReason();
  }

  async rerank(query: string, candidates: MemoryRecord[]): Promise<string[] | null> {
    if (!candidates?.length) return null;
    if (!this.llmFactory.isAvailable()) {
      this.logger.warn(`重排不可用,退化为 RRF 序: ${this.unavailableReason()}`);
      return null;
    }

    const items = candidates
      .map((c, i) => `${i + 1}. id=${c.id} | ${(c.summary || c.content || '').slice(0, RERANK_ITEM_MAX_CHARS)}`)
      .join('\n');
    const prompt = RERANK_PROMPT.replace('{query}', query ?? '')
      .replace('{items}', items)
      .replace('{topN}', String(RERANK_TOP_N));

    try {
      const response: any = await withTimeout(this.llmFactory.getModels().medium.invoke(prompt), RERANK_TIMEOUT_MS);
      const text = typeof response?.content === 'string' ? response.content : String(response ?? '');
      const ids = parseIdList(text);
      if (ids.length === 0) {
        this.logger.warn('重排输出无法解析,退化为 RRF 序');
        return null;
      }
      const known = new Set(candidates.map((c) => c.id));
      const ordered = ids.filter((id) => known.has(id));
      // 补齐模型漏掉的候选,保证不因重排丢召回
      for (const c of candidates) if (!ordered.includes(c.id)) ordered.push(c.id);
      return ordered.slice(0, Math.max(RERANK_TOP_N, 1));
    } catch (err) {
      this.logger.warn(`重排失败,退化为 RRF 序: ${(err as Error)?.message ?? 'unknown'}`);
      return null;
    }
  }
}

/** 解析模型输出的 id 数组(容忍 markdown 代码块与多余文本) */
export function parseIdList(text: string): string[] {
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf('[');
  const end = body.lastIndexOf(']');
  if (start >= 0 && end > start) {
    try {
      const parsed = JSON.parse(body.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
    } catch {
      /* fallthrough */
    }
  }
  return (body.match(/"([^"]+)"/g) ?? []).map((s) => s.slice(1, -1)).filter(Boolean);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`重排超时(${ms}ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
