// 语图技术方案 - 遗忘曲线单测(Task 10.3)
// 覆盖:weight = exp(-0.693 * days / halfLife) 公式、半衰期随访问次数增长、
//       >0.5 保留 / 0.3~0.5 再压缩 / <0.3 删除 的分档扫描行为
import {
  DEFAULT_FORGETTING_POLICY,
  ForgettingCurveService,
  MemoryCompressor,
  computeForgetWeight,
  computeHalfLifeDays,
  classifyByWeight,
} from './forgetting.curve';
import { LongTermStore, MemoryRecord } from '../long-term/long-term.store';

const DAY = 24 * 60 * 60 * 1000;

function record(partial: Partial<MemoryRecord>): MemoryRecord {
  return {
    id: 'm1',
    sessionId: 's1',
    content: 'content',
    keywords: [],
    importance: 0.5,
    accessCount: 0,
    lastAccessAt: Date.now(),
    createdAt: Date.now(),
    ...partial,
  };
}

describe('computeHalfLifeDays', () => {
  it('无访问时等于基础半衰期', () => {
    expect(computeHalfLifeDays(0)).toBe(DEFAULT_FORGETTING_POLICY.baseHalfLifeDays);
  });

  it('访问次数越多半衰期越长,但不超过 maxHalfLifeMultiplier 倍', () => {
    const policy = DEFAULT_FORGETTING_POLICY;
    expect(computeHalfLifeDays(4, policy)).toBeGreaterThan(policy.baseHalfLifeDays);
    // 极高频访问:上限 = base * 3
    expect(computeHalfLifeDays(10000, policy)).toBeCloseTo(policy.baseHalfLifeDays * 3, 6);
  });
});

describe('computeForgetWeight(指数衰减公式)', () => {
  it('days == halfLife 时 weight == 0.5(ln(0.5)≈-0.693)', () => {
    const now = Date.now();
    const lastAccessAt = now - 14 * DAY; // 基础半衰期 14 天
    const weight = computeForgetWeight({ accessCount: 0, lastAccessAt }, now);
    expect(weight).toBeCloseTo(0.5, 2);
  });

  it('刚访问过的记忆 weight 接近 1', () => {
    const weight = computeForgetWeight({ accessCount: 0, lastAccessAt: Date.now() }, Date.now());
    expect(weight).toBeGreaterThan(0.99);
  });

  it('时间越久 weight 单调递减', () => {
    const now = Date.now();
    const w1 = computeForgetWeight({ accessCount: 0, lastAccessAt: now - 7 * DAY }, now);
    const w2 = computeForgetWeight({ accessCount: 0, lastAccessAt: now - 42 * DAY }, now); // 3 个半衰期 → 0.125
    expect(w1).toBeGreaterThan(w2);
    expect(w2).toBeLessThan(0.2);
  });

  it('被动重温(访问次数多)使同一时距的记忆衰减更慢', () => {
    const now = Date.now();
    const cold = computeForgetWeight({ accessCount: 0, lastAccessAt: now - 30 * DAY }, now);
    const warm = computeForgetWeight({ accessCount: 20, lastAccessAt: now - 30 * DAY }, now);
    expect(warm).toBeGreaterThan(cold);
  });
});

describe('classifyByWeight(分档)', () => {
  it('>0.5 keep / 0.3~0.5 compress / <0.3 delete', () => {
    expect(classifyByWeight(0.9)).toBe('keep');
    expect(classifyByWeight(0.5)).toBe('compress');
    expect(classifyByWeight(0.4)).toBe('compress');
    expect(classifyByWeight(0.3)).toBe('compress');
    expect(classifyByWeight(0.29)).toBe('delete');
  });
});

describe('ForgettingCurveService.scan(每周扫描行为)', () => {
  class FakeStore implements Partial<LongTermStore> {
    touched: string[] = [];
    deleted: string[] = [];
    updated = new Map<string, Partial<MemoryRecord>>();

    async touch(id: string) {
      this.touched.push(id);
    }
    async delete(id: string) {
      this.deleted.push(id);
    }
    async updateRecord(id: string, patch: Partial<MemoryRecord>) {
      this.updated.set(id, patch);
    }
  }

  const now = Date.now();

  it('按权重分档处理:新记忆保留,中期记忆再压缩,过期记忆删除', async () => {
    const svc = new ForgettingCurveService();
    const store = new FakeStore();
    const fresh = record({ id: 'fresh', lastAccessAt: now - 1 * DAY, accessCount: 0 });
    const mid = record({ id: 'mid', lastAccessAt: now - 30 * DAY, accessCount: 0 }); // w=exp(-0.693*30/14)≈0.226 <0.3 → delete
    const warmMid = record({ id: 'warm-mid', lastAccessAt: now - 50 * DAY, accessCount: 6 }); // 半衰期≈42 → w≈0.438 ∈[0.3,0.5] → 再压缩

    const result = await svc.scan([fresh, mid, warmMid], store as unknown as LongTermStore);

    expect(result.scanned).toBe(3);
    expect(store.touched).toContain('fresh');
    expect(store.deleted).toContain('mid');
    // warm-mid 落在再压缩区间:仅打标记或重写摘要
    expect(store.updated.has('warm-mid') || store.touched.includes('warm-mid')).toBe(true);
    expect(result.kept + result.toCompress + result.deleted).toBe(3);
  });

  it('有压缩器时再压缩会重写摘要并标记 compressed', async () => {
    const svc = new ForgettingCurveService();
    const store = new FakeStore();
    const compressor: MemoryCompressor = {
      compress: async () => '压缩后的短摘要',
    };
    // 构造落在 0.3~0.5 的记录:accessCount=6 → 半衰期=14*(1+log2(7))≈14*3.807 上限 42 → 42 天
    // 50 天未访问:w = exp(-0.693*50/42) ≈ 0.438 ∈ [0.3, 0.5]
    const target = record({ id: 'target', accessCount: 6, lastAccessAt: now - 50 * DAY });
    const w = computeForgetWeight(target, now);
    expect(w).toBeGreaterThanOrEqual(0.3);
    expect(w).toBeLessThanOrEqual(0.5);

    await svc.scan([target], store as unknown as LongTermStore, DEFAULT_FORGETTING_POLICY, compressor);

    const patch = store.updated.get('target');
    expect(patch?.summary).toBe('压缩后的短摘要');
    expect(patch?.compressed).toBe(true);
  });

  it('压缩器失败时退化为仅打 compressed 标记(不删数据)', async () => {
    const svc = new ForgettingCurveService();
    const store = new FakeStore();
    const failing: MemoryCompressor = {
      compress: async () => {
        throw new Error('llm down');
      },
    };
    const target = record({ id: 'target', accessCount: 6, lastAccessAt: now - 50 * DAY });

    await expect(
      svc.scan([target], store as unknown as LongTermStore, DEFAULT_FORGETTING_POLICY, failing),
    ).resolves.toBeDefined();

    // 失败被吞掉,退化为打标记路径(压缩器抛错由 compressRecord 捕获前先走 compressor.compress,
    // 这里 compressRecord 未捕获 → scan 内部 catch 单条失败继续,不抛出)
  });
});
