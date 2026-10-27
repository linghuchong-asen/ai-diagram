// 语图留存与裂变加强批次 - 每日签到服务
// 规则（对用户说准确，与前端文案/增长文档一致）：
//   - 每日首次签到：当日生成额度 +1（bonus_generate，与分享/邀请同池 LEAST 3 封顶）；
//   - 连续签到每满 7 天的整数倍：会员有效期 +1 天（checkin_vip 增长事件），
//     让免费用户在决策付费前先体验到会员权益（全站免水印 + 每日 30 次）；
//   - 断签重置：昨日无签 → 今日 streak 从 1 重算；
//   - 当日重复签到幂等：不重复发奖、不重复计数（表唯一约束兜底）。
// 全部奖励为旁路语义：额度/会员发放失败只留痕，不影响签到主链路。
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DailyCheckinEntity } from './daily-checkin.entity';
import { AiDailyUsageEntity } from '../quota/ai-daily-usage.entity';
import { BillingService } from '../../billing/billing.service';
import { inviteDayKey } from '../../billing/invite';

/** 签到状态（前端契约） */
export interface CheckinStatusView {
  checkedToday: boolean;
  /** 当前连续签到天数（含今日，若今日已签） */
  streak: number;
}

/** 签到结果（前端契约） */
export interface CheckinResultView extends CheckinStatusView {
  alreadyChecked: boolean;
  /** 本次签到是否发放了额度奖励（幂等重放时为 false） */
  bonusGranted: boolean;
  /** 本次签到是否触发「连签满 7 天」会员奖励 */
  vipRewarded: boolean;
}

/** 连签会员奖励周期（每满 N 天送 1 天会员） */
export const CHECKIN_VIP_CYCLE = 7;

@Injectable()
export class CheckinService {
  private readonly logger = new Logger(CheckinService.name);

  constructor(
    @InjectRepository(DailyCheckinEntity)
    private readonly checkinRepo: Repository<DailyCheckinEntity>,
    @InjectRepository(AiDailyUsageEntity)
    private readonly usageRepo: Repository<AiDailyUsageEntity>,
    private readonly billingService: BillingService,
  ) {}

  /** 签到状态：今日是否已签 + 当前连续天数（旁路查询，失败按未签处理） */
  async status(userId: string | null | undefined): Promise<CheckinStatusView> {
    if (!userId) return { checkedToday: false, streak: 0 };
    try {
      const today = inviteDayKey();
      const [todayRow, latest] = await Promise.all([
        this.checkinRepo.findOne({ where: { userId: String(userId), day: today } }),
        this.checkinRepo.findOne({
          where: { userId: String(userId) },
          order: { day: 'DESC' },
        }),
      ]);
      return {
        checkedToday: !!todayRow,
        streak: Number(latest?.streak) || 0,
      };
    } catch (err) {
      this.logger.warn(`签到状态读取失败(按未签处理): ${(err as Error)?.message ?? err}`);
      return { checkedToday: false, streak: 0 };
    }
  }

  /**
   * 签到：当日首次 → 计 streak + 发奖；当日已签 → 幂等返回不重复发奖。
   */
  async checkin(userId: string | null | undefined): Promise<CheckinResultView> {
    const empty: CheckinResultView = {
      checkedToday: false,
      streak: 0,
      alreadyChecked: false,
      bonusGranted: false,
      vipRewarded: false,
    };
    if (!userId) return empty;
    const id = String(userId);
    const today = inviteDayKey();

    // 幂等：当日已签直接返回（防前端重复点击，表唯一约束兜底并发）
    const existing = await this.checkinRepo.findOne({
      where: { userId: id, day: today },
    });
    if (existing) {
      return {
        checkedToday: true,
        streak: Number(existing.streak) || 1,
        alreadyChecked: true,
        bonusGranted: false,
        vipRewarded: false,
      };
    }

    // 连续天数：昨日有签则续，否则重置 1
    const yesterdayKey = inviteDayKey(new Date(Date.now() - 24 * 3600 * 1000));
    const yesterday = await this.checkinRepo.findOne({
      where: { userId: id, day: yesterdayKey },
    });
    const streak = (Number(yesterday?.streak) || 0) + 1;

    let savedRow: DailyCheckinEntity | null = null;
    try {
      savedRow = await this.checkinRepo.save(
        this.checkinRepo.create({ userId: id, day: today, streak }),
      );
    } catch (err) {
      // 唯一约束冲突 = 并发重复签到：按幂等处理
      this.logger.warn(`签到落库冲突(按重复签到处理): ${(err as Error)?.message ?? err}`);
      const row = await this.checkinRepo.findOne({ where: { userId: id, day: today } });
      return {
        checkedToday: true,
        streak: Number(row?.streak) || streak,
        alreadyChecked: true,
        bonusGranted: false,
        vipRewarded: false,
      };
    }

    // 额度奖励：bonus_generate +1（LEAST 3 封顶，与分享/邀请同池）；失败只告警
    let bonusGranted = false;
    try {
      await this.usageRepo.query(
        `INSERT INTO ai_daily_usage (user_id, day, bonus_generate, updated_at)
         VALUES ($1, $2, 1, NOW())
         ON CONFLICT (user_id, day) DO UPDATE SET
           bonus_generate = LEAST(ai_daily_usage.bonus_generate + 1, 3),
           updated_at = NOW()`,
        [id, today],
      );
      bonusGranted = true;
    } catch (err) {
      this.logger.warn(`签到额度发放失败(不影响签到): ${(err as Error)?.message ?? err}`);
    }

    // 连签满 7 天整数倍 → 会员 +1 天（让免费用户体验会员权益后再决策付费）
    let vipRewarded = false;
    if (streak > 0 && streak % CHECKIN_VIP_CYCLE === 0) {
      try {
        await this.billingService.grantVipDays(id, 1, 'checkin_vip');
        vipRewarded = true;
      } catch (err) {
        this.logger.warn(`连签会员奖励发放失败: ${(err as Error)?.message ?? err}`);
      }
    }

    return {
      checkedToday: true,
      streak: savedRow.streak,
      alreadyChecked: false,
      bonusGranted,
      vipRewarded,
    };
  }
}
