// 语图技术方案 - 遗忘机制(指数衰减,每周扫描)
// 文档规则:
//   weight = exp(-0.693 * daysSinceLastAccess / halfLife)
//   半衰期随访问次数动态调整(被动重温越多,遗忘越慢)
//   >0.5 保留 / 0.3~0.5 再压缩 / <0.3 删除
// 说明:ln(0.5) ≈ -0.693,因此 days == halfLife 时 weight == 0.5。
import { Injectable, Logger } from '@nestjs/common';
import { LongTermStore, MemoryRecord } from '../long-term/long-term.store';

const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * MS_PER_DAY;
export const LN_HALF = 0.693;

export interface ForgettingPolicy {
  /** 基础半衰期(天),访问次数越多半衰期越长 */
  baseHalfLifeDays: number;
  /** 访问次数对半衰期的最大放大倍数(防止高频记忆永不遗忘) */
  maxHalfLifeMultiplier: number;
  keepThreshold: number; // weight > 该值保留
  compressThreshold: number; // 再压缩区间下界(= deleteThreshold 时为 0.3~0.5 再压缩)
  deleteThreshold: number; // weight < 该值删除
}

export const DEFAULT_FORGETTING_POLICY: ForgettingPolicy = {
  baseHalfLifeDays: 14,
  maxHalfLifeMultiplier: 3,
  keepThreshold: 0.5,
  compressThreshold: 0.3,
  deleteThreshold: 0.3,
};

export type ForgetAction = 'keep' | 'compress' | 'delete';

/** "再压缩"执行器:把一条记忆压缩为更短的事实摘要(由压缩节点提供实现) */
export interface MemoryCompressor {
  compress(record: MemoryRecord): Promise<string>;
}

export interface ScanResult {
  kept: number;
  toCompress: number;
  deleted: number;
  scanned: number;
}

/** 半衰期(天):随访问次数对数增长,上限为 maxHalfLifeMultiplier 倍基础半衰期 */
export function computeHalfLifeDays(
  accessCount: number,
  policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
): number {
  const accesses = Math.max(0, Number(accessCount) || 0);
  const multiplier = Math.min(policy.maxHalfLifeMultiplier, 1 + Math.log2(1 + accesses));
  return policy.baseHalfLifeDays * multiplier;
}

/** 遗忘权重:weight = exp(-0.693 * days / halfLife) */
export function computeForgetWeight(
  record: Pick<MemoryRecord, 'accessCount' | 'lastAccessAt'>,
  now: number = Date.now(),
  policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
): number {
  const lastAccess = Number(record?.lastAccessAt) || now;
  const days = Math.max(0, (now - lastAccess) / MS_PER_DAY);
  const halfLife = computeHalfLifeDays(record?.accessCount ?? 0, policy);
  if (halfLife <= 0) return 0;
  return Math.exp((-LN_HALF * days) / halfLife);
}

/** 按权重分档:>keep 保留 / [delete, keep] 再压缩 / <delete 删除 */
export function classifyByWeight(
  weight: number,
  policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
): ForgetAction {
  if (weight > policy.keepThreshold) return 'keep';
  if (weight >= policy.deleteThreshold) return 'compress';
  return 'delete';
}

@Injectable()
export class ForgettingCurveService {
  private readonly logger = new Logger(ForgettingCurveService.name);

  /** 计算某条记忆当前的遗忘权重 */
  computeWeight(
    record: Pick<MemoryRecord, 'accessCount' | 'lastAccessAt'>,
    now: number = Date.now(),
    policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
  ): number {
    return computeForgetWeight(record, now, policy);
  }

  /**
   * 执行每周遗忘扫描:
   *  - weight > keepThreshold:保留(被动重温,刷新访问时间)
   *  - deleteThreshold <= weight <= keepThreshold:再压缩(压缩叙事不压缩事实)
   *  - weight < deleteThreshold:删除
   */
  async runWeeklyScan(
    store: LongTermStore,
    policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
    compressor?: MemoryCompressor,
  ): Promise<ScanResult> {
    const records = await store.listAll();
    return this.scan(records, store, policy, compressor);
  }

  /** 扫描逻辑:接受显式记录列表,便于单测 */
  async scan(
    records: MemoryRecord[],
    store: LongTermStore,
    policy: ForgettingPolicy = DEFAULT_FORGETTING_POLICY,
    compressor?: MemoryCompressor,
  ): Promise<ScanResult> {
    const now = Date.now();
    const list = records ?? [];
    const result: ScanResult = { kept: 0, toCompress: 0, deleted: 0, scanned: list.length };

    for (const record of list) {
      const weight = computeForgetWeight(record, now, policy);
      const action = classifyByWeight(weight, policy);

      try {
        if (action === 'keep') {
          await store.touch(record.id);
          result.kept++;
        } else if (action === 'compress') {
          await this.compressRecord(record, store, compressor);
          result.toCompress++;
        } else {
          await store.delete(record.id);
          result.deleted++;
        }
      } catch (err) {
        this.logger.warn(`遗忘扫描处理记忆失败 id=${record.id}: ${(err as Error)?.message}`);
      }
    }

    this.logger.log(
      `遗忘扫描完成:扫描 ${result.scanned},保留 ${result.kept},再压缩 ${result.toCompress},删除 ${result.deleted}`,
    );
    return result;
  }

  /** 再压缩:有压缩器则重写摘要,否则仅打标记待压缩 */
  private async compressRecord(
    record: MemoryRecord,
    store: LongTermStore,
    compressor?: MemoryCompressor,
  ): Promise<void> {
    if (compressor) {
      const compressed = await compressor.compress(record);
      if (compressed) {
        await store.updateRecord(record.id, { summary: compressed, compressed: true });
        return;
      }
    }
    await store.updateRecord(record.id, { compressed: true });
  }
}
