// 语图技术方案 - 用户级每日配额/会话软上限单测(Task 11.5)
// 商业化首发扩展(Task 2):免费档 3 次/日边界、分享获赠 bonus、grantShareBonus LEAST 3 封顶、修改配额不受影响
import {
  QuotaService,
  QuotaExceededException,
  todayKey,
  SESSION_SOFT_NOTICE,
  DEFAULT_DAILY_GENERATE_LIMIT,
  DEFAULT_DAILY_MODIFY_LIMIT,
} from './quota.service';
import { AiDailyUsageEntity } from './ai-daily-usage.entity';

class FakeUsageRepo {
  rows = new Map<string, Partial<AiDailyUsageEntity>>();

  private key(userId: string, day: string) {
    return `${userId}|${day}`;
  }

  async findOne({ where: { userId, day } }: any) {
    return this.rows.get(this.key(userId, day)) ?? null;
  }

  /** 模拟 PG 原子 upsert 累加(consume 计量 + grantShareBonus 的 LEAST 封顶) */
  async query(_sql: string, params: any[]) {
    if (_sql.includes('bonus_generate')) {
      // 分享获赠:bonus_generate = LEAST(bonus_generate + 1, 3)
      const [userId, day] = params;
      const k = this.key(userId, day);
      const prev = this.rows.get(k) ?? { generateCount: 0, modifyCount: 0, tokens: 0, bonusGenerate: 0 };
      this.rows.set(k, {
        ...prev,
        userId,
        day,
        bonusGenerate: Math.min((Number(prev.bonusGenerate) || 0) + 1, 3),
      });
      return [];
    }
    const [userId, day, gen, mod, tokens] = params;
    const k = this.key(userId, day);
    const prev = this.rows.get(k) ?? { generateCount: 0, modifyCount: 0, tokens: 0, bonusGenerate: 0 };
    this.rows.set(k, {
      userId,
      day,
      generateCount: (Number(prev.generateCount) || 0) + gen,
      modifyCount: (Number(prev.modifyCount) || 0) + mod,
      tokens: (Number(prev.tokens) || 0) + tokens,
      bonusGenerate: Number(prev.bonusGenerate) || 0,
    });
    return [];
  }
}

function makeService(repo: FakeUsageRepo, env: Record<string, string> = {}): QuotaService {
  const config = { get: (key: string) => env[key] } as any;
  return new QuotaService(repo as any, config);
}

describe('todayKey', () => {
  it('返回 YYYY-MM-DD 格式', () => {
    expect(todayKey(new Date('2026-10-17T10:00:00'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('默认配额常量（Task 2 收紧）', () => {
  it('免费生成档默认 3 次/日（env AI_DAILY_GENERATE_LIMIT 可覆盖）,修改档 500 不动', () => {
    expect(DEFAULT_DAILY_GENERATE_LIMIT).toBe(3);
    expect(DEFAULT_DAILY_MODIFY_LIMIT).toBe(500);
  });
});

describe('assertCanRun(配额闸门)', () => {
  it('空用量直接放行', async () => {
    const svc = makeService(new FakeUsageRepo());
    await expect(svc.assertCanRun('u1')).resolves.toBeDefined();
  });

  it('Task 2 生成维度单独闸门:generate 用量 2/3 → 放行(第 3 次可过)', async () => {
    const repo = new FakeUsageRepo();
    repo.rows.set(`u1|${todayKey()}`, { generateCount: 2, modifyCount: 0, tokens: 0 });
    const svc = makeService(repo);
    await expect(svc.assertCanRun('u1')).resolves.toBeDefined();
  });

  it('Task 2 日限 3 边界:第 3 次耗尽后第 4 次 → 429 AI_QUOTA_EXCEEDED(modify 未满也拒)', async () => {
    const repo = new FakeUsageRepo();
    repo.rows.set(`u1|${todayKey()}`, { generateCount: 3, modifyCount: 0, tokens: 0 });
    const svc = makeService(repo);
    await expect(svc.assertCanRun('u1')).rejects.toThrow(QuotaExceededException);
    try {
      await svc.assertCanRun('u1');
    } catch (e: any) {
      expect(e.getStatus()).toBe(429);
      expect(e.response?.code).toBe('AI_QUOTA_EXCEEDED');
      expect(String(e.response?.message)).toContain('配额');
      expect(e.response?.scope).toBe('生成次数');
      expect(e.response?.limit).toBe(3);
    }
  });

  it('env AI_DAILY_GENERATE_LIMIT 覆盖默认 3(风险兜底能力保留)', async () => {
    const repo = new FakeUsageRepo();
    repo.rows.set(`u1|${todayKey()}`, { generateCount: 3, modifyCount: 0, tokens: 0 });
    const svc = makeService(repo, { AI_DAILY_GENERATE_LIMIT: '200' });
    await expect(svc.assertCanRun('u1')).resolves.toBeDefined();
  });

  it('token 超限 → 429', async () => {
    const repo = new FakeUsageRepo();
    repo.rows.set(`u1|${todayKey()}`, { generateCount: 0, modifyCount: 0, tokens: 600000 });
    const svc = makeService(repo, { AI_DAILY_TOKEN_LIMIT: '500000' });
    await expect(svc.assertCanRun('u1')).rejects.toThrow(QuotaExceededException);
  });

  it('Task 2 分享获赠提升生效额度:3 次耗尽 → 奖励后第 4 次可过', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    await svc.consume('u1', 'generate', 10);
    await svc.consume('u1', 'generate', 10);
    await svc.consume('u1', 'generate', 10);
    await expect(svc.assertCanRun('u1')).rejects.toThrow(QuotaExceededException);

    await svc.grantShareBonus('u1');
    const usage = await svc.getDailyUsage('u1');
    expect(usage.bonusGenerate).toBe(1);
    expect(usage.generateLimit).toBe(4); // 生效额度 = 基础 3 + 奖励 1
    await expect(svc.assertCanRun('u1')).resolves.toBeDefined();
  });
});

describe('grantShareBonus（Task 2 分享获赠）', () => {
  it('重复发放日奖励上限 3:发 5 次仍为 3(LEAST 封顶)', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    for (let i = 0; i < 5; i++) {
      await svc.grantShareBonus('u1');
    }
    const usage = await svc.getDailyUsage('u1');
    expect(usage.bonusGenerate).toBe(3);
    expect(usage.generateLimit).toBe(6); // 3 + 3
  });

  it('奖励只增 bonus,不动 generate/modify/tokens 计量', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    await svc.consume('u1', 'generate', 123);
    await svc.grantShareBonus('u1');
    const usage = await svc.getDailyUsage('u1');
    expect(usage.generateCount).toBe(1);
    expect(usage.modifyCount).toBe(0);
    expect(usage.tokens).toBe(123);
    expect(usage.bonusGenerate).toBe(1);
  });

  it('空 userId → 直接 no-op', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    await expect(svc.grantShareBonus('')).resolves.toBeUndefined();
    expect(repo.rows.size).toBe(0);
  });

  it('发放异常不抛出(旁路不影响分享主链路)', async () => {
    const badRepo = {
      findOne: async () => null,
      query: async () => {
        throw new Error('db down');
      },
    };
    const svc = makeService(badRepo as any);
    await expect(svc.grantShareBonus('u1')).resolves.toBeUndefined();
  });
});

describe('修改配额不受影响（Task 2 g:500 不动）', () => {
  it('modify 计量照常,500 次才满,满后 429(scope=修改次数)', async () => {
    const repo = new FakeUsageRepo();
    repo.rows.set(`u1|${todayKey()}`, { generateCount: 0, modifyCount: 499, tokens: 0 });
    const svc = makeService(repo);
    await expect(svc.assertCanRun('u1')).resolves.toBeDefined();

    repo.rows.set(`u1|${todayKey()}`, { generateCount: 0, modifyCount: 500, tokens: 0 });
    try {
      await svc.assertCanRun('u1');
      throw new Error('应当抛出 QuotaExceededException');
    } catch (e: any) {
      expect(e.getStatus()).toBe(429);
      expect(e.response?.scope).toBe('修改次数');
      expect(e.response?.limit).toBe(500);
    }
  });
});

describe('consume(generate/modify 分开计量 + tokens 累计)', () => {
  it('按意图分别累加次数,tokens 全意图累计', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    await svc.consume('u1', 'generate', 1000);
    await svc.consume('u1', 'generate', 500);
    await svc.consume('u1', 'modify', 300);
    await svc.consume('u1', 'consult', 200); // consult 只计 token

    const usage = await svc.getDailyUsage('u1');
    expect(usage.generateCount).toBe(2);
    expect(usage.modifyCount).toBe(1);
    expect(usage.tokens).toBe(2000);
    expect(usage.bonusGenerate).toBe(0);
  });

  it('不同用户/日期互不串号', async () => {
    const repo = new FakeUsageRepo();
    const svc = makeService(repo);
    await svc.consume('u1', 'generate', 100);
    await svc.consume('u2', 'generate', 50);
    expect((await svc.getDailyUsage('u1')).generateCount).toBe(1);
    expect((await svc.getDailyUsage('u2')).generateCount).toBe(1);
  });

  it('计量异常不抛出(旁路不影响主链路)', async () => {
    const badRepo = {
      findOne: async () => {
        throw new Error('db down');
      },
      query: async () => {
        throw new Error('db down');
      },
    };
    const svc = makeService(badRepo as any);
    await expect(svc.consume('u1', 'generate', 100)).resolves.toBeUndefined();
    const usage = await svc.getDailyUsage('u1');
    expect(usage.generateCount).toBe(0);
  });
});

describe('addSessionUsage(会话级软上限)', () => {
  it('接近阈值(>=80%)时返回提示,未接近时不返回', () => {
    const svc = makeService(new FakeUsageRepo(), { AI_SESSION_TOKEN_SOFT_LIMIT: '1000' });
    expect(svc.addSessionUsage('s1', 500).notice).toBeUndefined();
    expect(svc.addSessionUsage('s1', 300).notice).toBe(SESSION_SOFT_NOTICE); // 累计 800 = 80%
    expect(svc.addSessionUsage('s2', 100).notice).toBeUndefined();
  });

  it('不同会话独立计数;clearSession 重置', () => {
    const svc = makeService(new FakeUsageRepo(), { AI_SESSION_TOKEN_SOFT_LIMIT: '1000' });
    svc.addSessionUsage('sA', 900);
    expect(svc.addSessionUsage('sB', 100).notice).toBeUndefined();
    svc.clearSession('sA');
    expect(svc.addSessionUsage('sA', 100).notice).toBeUndefined();
  });
});
