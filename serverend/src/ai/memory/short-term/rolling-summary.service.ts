// 语图技术方案 - 滚动摘要(rollingSummary)
// 文档(memory.md):短期记忆每 2 轮触发一次滚动摘要,摘要写入 conversation_summaries 表并回填 Checkpoint State。
// 提示词:复用 prompts/compress.prompt.ts(compressPrompt),这是该提示词的唯一消费方。
// 降级:LLM 不可用(无密钥/超时/异常)时走规则摘要(截断拼接),并记录降级原因,不阻塞主链路。
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { compressPrompt } from '../../prompts/compress.prompt';
import { LlmFactory } from '../../adapters/llm.factory';
import { ConversationSummary } from '../summary/conversation_summary.entity';
import { CheckpointMessage, CheckpointService, ROLLING_SUMMARY_EVERY_TURNS } from './checkpoint.memory';

/** 单次滚动摘要最多纳入的历史消息条数(控制提示词体积) */
const SUMMARY_WINDOW_MESSAGES = 12;
/** 规则摘要每条消息截断长度 */
const RULE_SUMMARY_LINE_LEN = 120;
/** LLM 摘要超时(毫秒):摘要是旁路能力,不允许拖慢主链路 */
const SUMMARY_TIMEOUT_MS = 8000;

export interface RollingSummaryOutcome {
  summarized: boolean;
  summary?: string;
  /** 摘要来源:llm = 模型压缩;rule = 规则降级;skip = 本轮不触发 */
  source?: 'llm' | 'rule' | 'skip';
  /** 降级原因(仅 source=rule/skip 时有值) */
  degradedReason?: string;
}

@Injectable()
export class RollingSummaryService {
  private readonly logger = new Logger(RollingSummaryService.name);
  /** 正在摘要的会话,避免并发重复触发 */
  private readonly inflight = new Set<string>();

  constructor(
    private readonly checkpoints: CheckpointService,
    private readonly llmFactory: LlmFactory,
    @InjectRepository(ConversationSummary)
    private readonly summaryRepo: Repository<ConversationSummary>,
  ) {}

  /**
   * 每 2 轮触发一次滚动摘要(Task 10.1)。
   * @param sessionId 摘要落库维度(conversation_summaries.sessionId 唯一)
   * @param threadId  短期记忆 Checkpoint 维度
   */
  async maybeSummarize(
    sessionId: string,
    threadId: string,
    projectId?: string,
  ): Promise<RollingSummaryOutcome> {
    if (!sessionId || !threadId) return { summarized: false, source: 'skip', degradedReason: '缺少 sessionId/threadId' };

    const state = await this.checkpoints.get(threadId);
    if (!state || state.messages.length === 0) {
      return { summarized: false, source: 'skip', degradedReason: '短期记忆为空' };
    }
    if (state.messages.length % ROLLING_SUMMARY_EVERY_TURNS !== 0) {
      return { summarized: false, source: 'skip', degradedReason: '未到摘要周期' };
    }
    if (this.inflight.has(threadId)) {
      return { summarized: false, source: 'skip', degradedReason: '同线程摘要进行中' };
    }

    this.inflight.add(threadId);
    try {
      const history = state.messages.slice(-SUMMARY_WINDOW_MESSAGES);
      const { summary, source, degradedReason } = await this.compress(history, state.lastSummary);
      if (!summary) return { summarized: false, source: 'skip', degradedReason: degradedReason ?? '摘要为空' };

      await this.persist(sessionId, summary, projectId);
      await this.checkpoints.updateSummary(threadId, summary);
      this.logger.log(`滚动摘要完成: session=${sessionId}, 来源=${source}, 长度=${summary.length}`);
      return { summarized: true, summary, source, degradedReason };
    } catch (err) {
      const msg = (err as Error)?.message ?? 'unknown';
      this.logger.warn(`滚动摘要失败(不阻塞主链路): session=${sessionId}, ${msg}`);
      return { summarized: false, source: 'skip', degradedReason: msg };
    } finally {
      this.inflight.delete(threadId);
    }
  }

  /** 读取会话摘要(供上下文组装的记忆段使用) */
  async getSummary(sessionId: string): Promise<string> {
    if (!sessionId) return '';
    try {
      const row = await this.summaryRepo.findOne({ where: { sessionId } });
      return row?.summary ?? '';
    } catch (err) {
      this.logger.warn(`读取会话摘要失败: session=${sessionId}, ${(err as Error)?.message}`);
      return '';
    }
  }

  /** 压缩:优先 LLM(compressPrompt),失败/不可用退化为规则摘要 */
  private async compress(
    messages: CheckpointMessage[],
    previousSummary?: string,
  ): Promise<{ summary: string; source: 'llm' | 'rule'; degradedReason?: string }> {
    const historyText = this.renderHistory(messages, previousSummary);

    if (this.llmFactory.isAvailable()) {
      try {
        const prompt = await compressPrompt.format({ history: historyText });
        const response: any = await withTimeout(
          this.llmFactory.getModels().medium.invoke(prompt),
          SUMMARY_TIMEOUT_MS,
        );
        const text = extractText(response);
        if (text) return { summary: text, source: 'llm' };
        return { summary: this.ruleSummary(messages, previousSummary), source: 'rule', degradedReason: '模型返回空摘要' };
      } catch (err) {
        return {
          summary: this.ruleSummary(messages, previousSummary),
          source: 'rule',
          degradedReason: `LLM 摘要失败: ${(err as Error)?.message ?? 'unknown'}`,
        };
      }
    }

    return {
      summary: this.ruleSummary(messages, previousSummary),
      source: 'rule',
      degradedReason: this.llmFactory.getUnavailableReason() ?? 'LLM 不可用',
    };
  }

  private renderHistory(messages: CheckpointMessage[], previousSummary?: string): string {
    const lines = messages.map((m) => `${m.role === 'user' ? '用户' : '助手'}: ${m.content}`);
    if (previousSummary) lines.unshift(`【已有摘要】${previousSummary}`);
    return lines.join('\n');
  }

  /** 规则摘要:保留角色与关键句(压缩叙事不压缩事实的最低保障) */
  private ruleSummary(messages: CheckpointMessage[], previousSummary?: string): string {
    const lines = messages.map((m) => {
      const text = (m.content ?? '').replace(/\s+/g, ' ').trim();
      return `- ${m.role === 'user' ? '用户' : '助手'}: ${text.slice(0, RULE_SUMMARY_LINE_LEN)}`;
    });
    const body = lines.join('\n');
    return previousSummary ? `【前序】${previousSummary}\n${body}` : body;
  }

  /** upsert conversation_summaries(按 sessionId 唯一) */
  private async persist(sessionId: string, summary: string, projectId?: string): Promise<void> {
    const existing = await this.summaryRepo.findOne({ where: { sessionId } });
    if (existing) {
      existing.summary = summary;
      if (projectId) existing.projectId = projectId;
      await this.summaryRepo.save(existing);
      return;
    }
    await this.summaryRepo.save(this.summaryRepo.create({ sessionId, summary, projectId }));
  }
}

function extractText(response: unknown): string {
  const r = response as any;
  if (!r) return '';
  if (typeof r === 'string') return r.trim();
  if (typeof r.content === 'string') return r.content.trim();
  if (typeof r.text === 'string') return r.text.trim();
  try {
    return String(r.content ?? '').trim();
  } catch {
    return '';
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`摘要超时(${ms}ms)`)), ms);
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
