// 语图技术方案 - Token 三级防护之用户级/会话级(Task 11.5)
// 文档(security.md Token 成本防护):
//   用户级:每用户每日配额,generate/modify 分开计量(生成消耗远大于修改),tokens 单独累计;
//   会话级:单会话 token 软上限,接近阈值在 AiResult 响应附提示字段(不打断对话);
//   调用级:max_tokens 硬上限在 adapters/llm.factory(LlmFactory.getMaxOutputTokens),不在此处。
// 实现:PG 表 ai_daily_usage 原子累加(无 Redis 依赖);会话级为进程内计数(会话本身是进程内概念)。
import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { HttpException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiDailyUsageEntity } from './ai-daily-usage.entity';
import { IntentType } from '../schemas/chat.schema';

/** 默认配额(环境变量可覆盖) */
// Task 2 商业化收紧:免费生成档从 200/日 改 3/日(env AI_DAILY_GENERATE_LIMIT 可覆盖,风险兜底)
export const DEFAULT_DAILY_GENERATE_LIMIT = 3;
export const DEFAULT_DAILY_MODIFY_LIMIT = 500;
export const DEFAULT_DAILY_TOKEN_LIMIT = 500_000;
/** 会话级软上限:达到阈值的 80% 即在响应中附提示(security.md:主动提示,不中断) */
export const DEFAULT_SESSION_TOKEN_SOFT_LIMIT = 100_000;
export const SESSION_SOFT_NOTICE_RATIO = 0.8;

export const SESSION_SOFT_NOTICE =
  '当前会话已消耗较多 AI 资源，建议开启新会话或精简需求，以获得更快的响应。';

/** 进程内会话计数上限(超限按 LRU 淘汰最久未访问项,防 Map 无界增长) */
export const MAX_TRACKED_SESSIONS = 5000;

export interface DailyUsageView {
  day: string;
  generateCount: number;
  modifyCount: number;
  tokens: number;
  /** 生效生成额度 = 基础 limit + 当日分享奖励(Task 2;前端沿用原字段即可显示正确额度) */
  generateLimit: number;
  /** 当日分享获赠次数(新增字段,便于前端展示「含分享奖励 +N」) */
  bonusGenerate: number;
  modifyLimit: number;
  tokenLimit: number;
}

/** 用户级配额超限:429 + 明确错误码与提示(controller 直接透传) */
export class QuotaExceededException extends HttpException {
  constructor(detail: { scope: string; limit: number; used: number; hint: string }) {
    super(
      {
        code: 'AI_QUOTA_EXCEEDED',
        message: `今日 AI 配额已用完(${detail.scope}):已用 ${detail.used}/${detail.limit}。${detail.hint}`,
        ...detail,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** 本地时区的 YYYY-MM-DD(按天重置的计量窗口) */
export function todayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

@Injectable()
export class QuotaService {
  private readonly logger = new Logger(QuotaService.name);
  /** 会话级软上限计数(进程内;sessionId → 累计 token) */
  private readonly sessionUsage = new Map<string, number>();

  constructor(
    @InjectRepository(AiDailyUsageEntity)
    private readonly usageRepo: Repository<AiDailyUsageEntity>,
    private readonly config: ConfigService,
  ) {}

  private get generateLimit(): number {
    return this.positiveInt('AI_DAILY_GENERATE_LIMIT', DEFAULT_DAILY_GENERATE_LIMIT);
  }

  private get modifyLimit(): number {
    return this.positiveInt('AI_DAILY_MODIFY_LIMIT', DEFAULT_DAILY_MODIFY_LIMIT);
  }

  private get tokenLimit(): number {
    return this.positiveInt('AI_DAILY_TOKEN_LIMIT', DEFAULT_DAILY_TOKEN_LIMIT);
  }

  private get sessionSoftLimit(): number {
    return this.positiveInt('AI_SESSION_TOKEN_SOFT_LIMIT', DEFAULT_SESSION_TOKEN_SOFT_LIMIT);
  }

  private positiveInt(key: string, fallback: number): number {
    const raw = Number(this.config.get(key));
    return Number.isFinite(raw) && raw > 0 ? raw : fallback;
  }

  /** 读取某用户当日用量(表不存在等异常按 0 用量处理,配额不阻断主链路) */
  async getDailyUsage(userId: string): Promise<DailyUsageView> {
    const empty: DailyUsageView = {
      day: todayKey(),
      generateCount: 0,
      modifyCount: 0,
      tokens: 0,
      generateLimit: this.generateLimit,
      bonusGenerate: 0,
      modifyLimit: this.modifyLimit,
      tokenLimit: this.tokenLimit,
    };
    if (!userId) return empty;
    try {
      const row = await this.usageRepo.findOne({
        where: { userId: String(userId), day: todayKey() },
      });
      // Task 2:分享获赠 bonus_generate 提升生效生成额度(基础 limit + bonus)
      const bonusGenerate = Number(row?.bonusGenerate) || 0;
      return {
        ...empty,
        generateCount: Number(row?.generateCount) || 0,
        modifyCount: Number(row?.modifyCount) || 0,
        tokens: Number(row?.tokens) || 0,
        bonusGenerate,
        generateLimit: this.generateLimit + bonusGenerate,
      };
    } catch (err) {
      this.logger.warn(`读取每日用量失败(按 0 处理): ${(err as Error)?.message ?? err}`);
      return empty;
    }
  }

  /**
   * 配额闸门(Task 11.5 起用,Task 2 收紧语义):创建线程前调用。
   * 生成维度单独闸门:免费档收紧为 3 次/日 + 分享奖励 bonus 后,若沿用旧
   * 「生成与修改都满才拒」联合判定,3/日 限制将形同虚设(modify 500/日实际用不满),
   * 故生成维度改为单独拒绝;modify/token 维度语义不变。
   */
  async assertCanRun(userId: string): Promise<DailyUsageView> {
    const usage = await this.getDailyUsage(userId);
    if (usage.generateCount >= usage.generateLimit) {
      throw new QuotaExceededException({
        scope: '生成次数',
        used: usage.generateCount,
        limit: usage.generateLimit,
        hint: '分享项目可获得额外生成次数（每日最多 +3），或明日再试。',
      });
    }
    if (usage.modifyCount >= usage.modifyLimit) {
      throw new QuotaExceededException({
        scope: '修改次数',
        used: usage.modifyCount,
        limit: usage.modifyLimit,
        hint: '请明日再试，或联系管理员调整 AI_DAILY_MODIFY_LIMIT。',
      });
    }
    if (usage.tokens >= usage.tokenLimit) {
      throw new QuotaExceededException({
        scope: 'token 用量',
        used: usage.tokens,
        limit: usage.tokenLimit,
        hint: '请明日再试，或联系管理员调整 AI_DAILY_TOKEN_LIMIT。',
      });
    }
    return usage;
  }

  /**
   * 运行结束后计量:generate/modify 分开累加次数,token 全意图累计。
   * 失败只告警,不影响主链路(计量是旁路)。
   */
  async consume(userId: string, intent: IntentType | undefined, tokens: number): Promise<void> {
    if (!userId) return;
    const day = todayKey();
    const generateDelta = intent === 'generate' ? 1 : 0;
    const modifyDelta = intent === 'modify' ? 1 : 0;
    const tokenDelta = Math.max(0, Math.ceil(Number(tokens) || 0));
    try {
      await this.usageRepo.query(
        `INSERT INTO ai_daily_usage (user_id, day, generate_count, modify_count, tokens, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id, day) DO UPDATE SET
           generate_count = ai_daily_usage.generate_count + EXCLUDED.generate_count,
           modify_count = ai_daily_usage.modify_count + EXCLUDED.modify_count,
           tokens = ai_daily_usage.tokens + EXCLUDED.tokens,
           updated_at = NOW()`,
        [String(userId), day, generateDelta, modifyDelta, tokenDelta],
      );
    } catch (err) {
      this.logger.warn(`每日用量计量失败(不影响主链路): ${(err as Error)?.message ?? err}`);
    }
  }

  /**
   * Task 2 分享获赠:首次成功分享奖励当日生成次数 +1,日奖励上限 3。
   * 原生 SQL ON CONFLICT 原子自增(LEAST 封顶),与 consume 同表同键;
   * 失败只告警不抛出 —— 奖励是旁路,绝不阻断分享主链路。
   */
  async grantShareBonus(userId: string): Promise<void> {
    if (!userId) return;
    const day = todayKey();
    try {
      await this.usageRepo.query(
        `INSERT INTO ai_daily_usage (user_id, day, generate_count, modify_count, tokens, bonus_generate, updated_at)
         VALUES ($1, $2, 0, 0, 0, 1, NOW())
         ON CONFLICT (user_id, day) DO UPDATE SET
           bonus_generate = LEAST(ai_daily_usage.bonus_generate + 1, 3),
           updated_at = NOW()`,
        [String(userId), day],
      );
    } catch (err) {
      this.logger.warn(`分享奖励发放失败(不阻断分享主链路): ${(err as Error)?.message ?? err}`);
    }
  }

  /** 会话级软上限:累计并在接近阈值时返回提示字段(AiResult.notice) */
  addSessionUsage(sessionId: string, tokens: number): { sessionTokens: number; notice?: string } {
    if (!sessionId) return { sessionTokens: 0 };
    const delta = Math.max(0, Math.ceil(Number(tokens) || 0));
    const prev = this.sessionUsage.get(sessionId) ?? 0;
    const total = prev + delta;
    // LRU:访问即移到队尾(Map 保持插入序),配合超限淘汰防止长期运行下 Map 无界增长
    this.sessionUsage.delete(sessionId);
    this.sessionUsage.set(sessionId, total);
    this.evictSessionOverflow();
    if (total >= this.sessionSoftLimit * SESSION_SOFT_NOTICE_RATIO) {
      return { sessionTokens: total, notice: SESSION_SOFT_NOTICE };
    }
    return { sessionTokens: total };
  }

  /** 超出上限 → 淘汰最久未访问的会话计数(仅影响软上限提示的累计基数,不影响用户级配额) */
  private evictSessionOverflow(): void {
    while (this.sessionUsage.size > MAX_TRACKED_SESSIONS) {
      const oldestKey = this.sessionUsage.keys().next().value;
      if (oldestKey === undefined) break;
      this.sessionUsage.delete(oldestKey);
    }
  }

  /** 会话结束清理(防进程内 Map 无界增长) */
  clearSession(sessionId: string): void {
    if (sessionId) this.sessionUsage.delete(sessionId);
  }
}
