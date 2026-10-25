// 语图技术方案 - 工具多轮上下文存储(Task 8.5)
// 用途:同一 thread 的多次工具调用之间传递「上一次工具产出的中间态」,
//       让模型可以说「在上一次匹配到的模板上改」,而不必把整份数据塞回提示词。
// 约束(内存安全):
//   - 有界:最多 MAX_ENTRIES 条,超出按 LRU 淘汰最久未访问项;
//   - TTL:超过 TTL_MS 的条目在读写时惰性清理,并由清理定时器兜底;
//   - 进程内存储:多实例部署需换 Redis(见报告「跨模块协调需求」)。
import { Injectable, Logger } from '@nestjs/common';

/** 上下文条目上限(防内存泄漏) */
export const MAX_ENTRIES = 200;
/** 条目存活时间:10 分钟(与 thread 清理节奏同量级) */
export const TTL_MS = 10 * 60 * 1000;

export interface ToolContextEntry {
  contextId: string;
  threadId?: string;
  tool: string;
  payload: unknown;
  createdAt: number;
  updatedAt: number;
}

@Injectable()
export class ToolContextStore {
  private readonly logger = new Logger(ToolContextStore.name);
  /** Map 保持插入序;每次访问都「删除再插入」以实现 LRU 语义 */
  private readonly entries = new Map<string, ToolContextEntry>();

  /** 写入/更新上下文;超出上限时淘汰最久未访问的条目 */
  set(input: { contextId: string; threadId?: string; tool: string; payload: unknown }): void {
    const now = Date.now();
    const existed = this.entries.get(input.contextId);
    this.entries.delete(input.contextId);
    this.entries.set(input.contextId, {
      contextId: input.contextId,
      threadId: input.threadId ?? existed?.threadId,
      tool: input.tool,
      payload: input.payload,
      createdAt: existed?.createdAt ?? now,
      updatedAt: now,
    });
    this.evictOverflow();
  }

  /** 读取上下文(命中即刷新 LRU 位置);过期条目直接删除并返回 undefined */
  get(contextId: string): ToolContextEntry | undefined {
    const entry = this.entries.get(contextId);
    if (!entry) return undefined;
    if (this.isExpired(entry)) {
      this.entries.delete(contextId);
      return undefined;
    }
    // LRU:访问即移到队尾
    this.entries.delete(contextId);
    entry.updatedAt = Date.now();
    this.entries.set(contextId, entry);
    return entry;
  }

  delete(contextId: string): boolean {
    return this.entries.delete(contextId);
  }

  /** 清理某 thread 下的全部上下文(thread 结束时调用,避免长期驻留) */
  deleteByThread(threadId: string): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (entry.threadId === threadId) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  /** 惰性 + 定时清理过期条目;返回清理条数 */
  cleanupExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (now - entry.updatedAt > TTL_MS) {
        this.entries.delete(id);
        removed += 1;
      }
    }
    if (removed > 0) this.logger.debug(`清理过期工具上下文 ${removed} 条`);
    return removed;
  }

  get size(): number {
    return this.entries.size;
  }

  private isExpired(entry: ToolContextEntry): boolean {
    return Date.now() - entry.updatedAt > TTL_MS;
  }

  /** 超出上限 → 按 Map 插入序淘汰最前面的(即最久未访问) */
  private evictOverflow(): void {
    while (this.entries.size > MAX_ENTRIES) {
      const oldestKey = this.entries.keys().next().value;
      if (oldestKey === undefined) break;
      this.entries.delete(oldestKey);
      this.logger.debug(`工具上下文超出上限(${MAX_ENTRIES}),淘汰最久未访问条目: ${oldestKey}`);
    }
  }
}
