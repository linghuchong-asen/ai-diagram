// 语图技术方案 - 短期记忆(Checkpointer)
// 文档:短期记忆 = LangGraph Checkpointer 每轮落 State,每 2 轮 rollingSummary
// 本实现提供 CheckpointSaver 接口(兼容 LangGraph MemorySaver 语义),
// 内存实现为默认;Redis(需外部 KvBackend)与 PG(PgCheckpointSaver)可切换,
// 由环境变量 CHECKPOINT_STORE=memory|redis|pg 在 AiModule 装配时决定。
import { Injectable, Logger, Optional } from '@nestjs/common';

export interface CheckpointMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CheckpointState {
  threadId: string;
  messages: CheckpointMessage[];
  turnCount: number;
  lastSummary: string;
  rollingSummaries: string[];
  updatedAt: number;
}

export interface CheckpointSaver {
  get(threadId: string): Promise<CheckpointState | null>;
  put(state: CheckpointState): Promise<void>;
  delete(threadId: string): Promise<void>;
  list(limit?: number): Promise<CheckpointState[]>;
}

/** 滚动摘要触发周期(文档:每 2 轮生成一次 rollingSummary) */
export const ROLLING_SUMMARY_EVERY_TURNS = 2;

/** 话题切换后短期记忆的 trim 策略:仅保留最近 N 条原文,更早的以摘要承接 */
export const TOPIC_SHIFT_KEEP_MESSAGES = 2;

// Redis 后端实现(与现有 redis 客户端适配)
export interface KvBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  del(key: string): Promise<void>;
  keys(pattern: string): Promise<string[]>;
}

export class RedisCheckpointSaver implements CheckpointSaver {
  private readonly logger = new Logger(RedisCheckpointSaver.name);
  private readonly prefix = 'ai:checkpoint:';

  constructor(private readonly kv: KvBackend) {}

  private key(threadId: string) {
    return `${this.prefix}${threadId}`;
  }

  async get(threadId: string): Promise<CheckpointState | null> {
    const raw = await this.kv.get(this.key(threadId));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CheckpointState;
    } catch {
      this.logger.warn(`checkpoint 解析失败: ${threadId}`);
      return null;
    }
  }

  async put(state: CheckpointState): Promise<void> {
    await this.kv.set(this.key(state.threadId), JSON.stringify(state));
  }

  async delete(threadId: string): Promise<void> {
    await this.kv.del(this.key(threadId));
  }

  async list(limit = 20): Promise<CheckpointState[]> {
    const keys = await this.kv.keys(`${this.prefix}*`);
    const states: CheckpointState[] = [];
    for (const k of keys.slice(0, limit)) {
      const raw = await this.kv.get(k);
      if (raw) {
        try {
          states.push(JSON.parse(raw));
        } catch {
          /* skip corrupt */
        }
      }
    }
    return states.sort((a, b) => b.updatedAt - a.updatedAt);
  }
}

export class InMemoryCheckpointSaver implements CheckpointSaver {
  private store = new Map<string, CheckpointState>();

  async get(threadId: string): Promise<CheckpointState | null> {
    return this.store.get(threadId) ?? null;
  }

  async put(state: CheckpointState): Promise<void> {
    this.store.set(state.threadId, { ...state });
  }

  async delete(threadId: string): Promise<void> {
    this.store.delete(threadId);
  }

  async list(limit = 20): Promise<CheckpointState[]> {
    return [...this.store.values()]
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, limit);
  }
}

@Injectable()
export class CheckpointService {
  private readonly logger = new Logger(CheckpointService.name);
  private saver: CheckpointSaver;

  // NOTE:@Optional() 必须保留：CheckpointSaver 是接口,tsc 发射的 paramtypes 为 Object,
  //       DI 无法按 token 解析;显式标记可选后未装配时注入 undefined,由 ?? 兜底内存实现。
  constructor(@Optional() saver?: CheckpointSaver) {
    // 默认使用内存实现;接入 Redis/PG 后通过配置切换(AiModule 注入 saver)
    this.saver = saver ?? new InMemoryCheckpointSaver();
  }

  setSaver(saver: CheckpointSaver) {
    this.saver = saver;
  }

  /** 当前使用的后端实现(日志/排障用) */
  getSaverName(): string {
    return this.saver.constructor?.name ?? 'unknown';
  }

  async get(threadId: string) {
    return this.saver.get(threadId);
  }

  async saveTurn(
    threadId: string,
    role: 'user' | 'assistant',
    content: string,
  ): Promise<CheckpointState> {
    const prev = (await this.saver.get(threadId)) ?? emptyState(threadId);

    prev.messages.push({ role, content });
    prev.turnCount += 1;
    prev.updatedAt = Date.now();

    // rollingSummary:每 2 轮对最近的对话生成摘要(由 RollingSummaryService 执行,
    // 状态中保留原文,摘要写入 lastSummary / rollingSummaries 与 conversation_summaries 表)
    await this.saver.put(prev);
    return prev;
  }

  /** 是否需要触发滚动摘要(每 ROLLING_SUMMARY_EVERY_TURNS 条消息一次) */
  shouldSummarize(state: CheckpointState | null): boolean {
    if (!state) return false;
    return state.messages.length > 0 && state.messages.length % ROLLING_SUMMARY_EVERY_TURNS === 0;
  }

  async updateSummary(threadId: string, summary: string): Promise<void> {
    const state = (await this.saver.get(threadId)) ?? emptyState(threadId);
    if (!summary) return;
    state.lastSummary = summary;
    state.rollingSummaries.push(summary);
    state.updatedAt = Date.now();
    await this.saver.put(state);
  }

  /**
   * 话题切换后的 trim:只保留最近 keep 条原文,更早的原文由摘要承接(文档:压缩叙事不压缩事实)。
   * 返回被裁剪掉的消息条数。
   */
  async trimMessages(threadId: string, keep = TOPIC_SHIFT_KEEP_MESSAGES): Promise<number> {
    const state = await this.saver.get(threadId);
    if (!state) return 0;
    if (state.messages.length <= keep) return 0;
    const removed = state.messages.length - keep;
    state.messages = state.messages.slice(-keep);
    state.updatedAt = Date.now();
    await this.saver.put(state);
    this.logger.log(`话题切换:短期记忆裁剪 ${removed} 条原文(thread=${threadId},保留最近 ${keep} 条)`);
    return removed;
  }

  async clear(threadId: string): Promise<void> {
    await this.saver.delete(threadId);
  }

  async list(limit = 20) {
    return this.saver.list(limit);
  }
}

function emptyState(threadId: string): CheckpointState {
  return {
    threadId,
    messages: [],
    turnCount: 0,
    lastSummary: '',
    rollingSummaries: [],
    updatedAt: Date.now(),
  };
}
