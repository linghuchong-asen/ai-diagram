// 语图 - 计费服务：按次解锁（Task 6）+ 会员月卡 + 营收看板（商业化闭环批次）
// 状态机：unlock_order/vip_order.status 单向 pending → paid（无退款流）；
//         project.unlocked 单向 false → true；user.vip_expire_time 只增不减。
// 支付安全四原则（两种订单、两条通道共用同一套闸门）：
//   1) 验签不过不动库 —— 虎皮椒回调按 MD5 验签，mock 回调按 HMAC 验签，失败直接拒绝；
//   2) 归属校验防越权 —— 下单/查单均校验资源归属，不匹配统一 404 防枚举；
//   3) 金额只信服务端 —— amount 取自 env（unlock: UNLOCK/FIRST_UNLOCK_PRICE_FEN，
//      vip: VIP_MONTH/VIP_MONTH_FIRST_PRICE_FEN），回调中的金额字段不作为放行依据；
//   4) 回调幂等 —— 已 paid 的订单收到重复回调直接确认（true），不再改库、不再记增长事件。
// 通道抽象：PAYMENT_ADAPTER 按环境工厂注入（PAY_CHANNEL=mock|xunhupay，默认 xunhupay），
//   回调放行统一走 dispatchPaidOrder（查 unlock_order → vip_order 两表分发），
//   使真实通道（虎皮椒）与沙箱通道（mock）行为完全一致，仅验签方式不同。
import { randomUUID } from 'crypto';
import { HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { customLogger } from '../utils/log/logger.service';
import { ProjectEntity } from '../operationalModules/projectManager/entities/project_manager.entity';
import { UserEntity } from '../user/entities/user.entity';
import { AiDailyUsageEntity } from '../ai/quota/ai-daily-usage.entity';
import { UnlockOrderEntity } from './entities/unlock_order.entity';
import { VipOrderEntity } from './entities/vip_order.entity';
import { InviteMilestoneEntity } from './entities/invite-milestone.entity';
import {
  PaymentAdapter,
  PaymentOrderKind,
} from './adapters/payment-adapter';
import { PAYMENT_ADAPTER } from './payment-adapter.token';
import { xunhupaySign } from './adapters/xunhupay.adapter';
import { mockPayEnabled, mockPaySign } from './adapters/mock-pay.adapter';
import { VIP_MONTH_DAYS, isVipActive } from './membership';
import {
  INVITE_MILESTONES,
  INVITE_REWARD_DAILY_CAP,
  INVITE_WELCOME_BONUS,
  generateInviteCode,
  inviteDayKey,
} from './invite';

/** 会员时长（天/单）：从 membership.ts 引入（配额/项目/分享判定共用同一口径） */

/** 默认解锁价格（单位：分，1.90 元）；可用 env UNLOCK_PRICE_FEN 覆盖 */
const DEFAULT_UNLOCK_PRICE_FEN = 190;

/** 首单优惠价（单位：分，0.90 元）；可用 env FIRST_UNLOCK_PRICE_FEN 覆盖（快赢批次一） */
const DEFAULT_FIRST_UNLOCK_PRICE_FEN = 90;

/** 会员月卡价格（单位：分，9.90 元）；可用 env VIP_MONTH_PRICE_FEN 覆盖 */
const DEFAULT_VIP_MONTH_PRICE_FEN = 990;

/** 会员首月特惠价（单位：分，5.90 元）；可用 env VIP_MONTH_FIRST_PRICE_FEN 覆盖 */
const DEFAULT_VIP_MONTH_FIRST_PRICE_FEN = 590;

/** 会员 SKU（年卡/季卡后续扩展） */
const VIP_MONTH_SKU = 'vip_month';

/** 会员在期判定工具对外再导出（quota/projectManager/projectShare 从 membership.ts 引入） */
export { isVipActive } from './membership';

/** 虎皮椒回调中表示订单已支付完成的状态值（以官方文档为准，接入时需人工比对） */
const XUNHU_STATUS_ORDER_DONE = 'OD';

/** 下单结果（前端契约）：pay = 跳转支付；sponsor = 通道未配置走赞助引导 */
export interface CreateUnlockOrderResult {
  orderId: string | null;
  mode?: 'pay' | 'sponsor';
  payUrl?: string;
  alreadyUnlocked?: boolean;
  /** 快赢批次一：本次是否按首单优惠价下单（前端展示「首单特惠」标记） */
  firstOrder?: boolean;
}

/** 会员下单结果（前端契约，语义与解锁下单一致） */
export interface CreateVipOrderResult {
  orderId: string | null;
  mode?: 'pay' | 'sponsor';
  payUrl?: string;
  /** 本次是否用户首张会员单（前端展示「首月特惠」标记 + 漏斗复购口径） */
  firstOrder?: boolean;
}

/** 订单查询结果（前端契约） */
export interface UnlockOrderView {
  orderId: string;
  projectId: string;
  status: 'pending' | 'paid';
  amount: number;
  channel: string;
}

/** 会员订单查询结果（前端契约） */
export interface VipOrderView {
  orderId: string;
  sku: string;
  status: 'pending' | 'paid';
  amount: number;
  channel: string;
}

/** 会员状态（前端契约）：vip = 当前时间在有效期内 */
export interface VipStatusView {
  vip: boolean;
  /** ISO 字符串；从未开通为 null（历史会员已过期也回传，供前端计算过期天数） */
  vipExpireTime: string | null;
  /** 在期剩余整天数（ceil，≥1；非在期为 null）——续费提醒的服务端唯一口径 */
  daysLeft: number | null;
  /** 已过期整天数（floor ≥1；在期/从未开通为 null）——到期横幅「额度已回落」唤醒口径 */
  expiredDays: number | null;
}

/** 营收看板 - 单窗口营收汇总 */
export interface RevenueWindow {
  /** 解锁单：笔数与 GMV（分） */
  unlockOrders: number;
  unlockGmvFen: number;
  /** 会员单：笔数与 GMV（分） */
  vipOrders: number;
  vipGmvFen: number;
}

/** 营收看板 - 日趋势点（付费转化增强批次）：某日双订单类型的 GMV（分） */
export interface DailyTrendPoint {
  day: string;
  unlockGmvFen: number;
  vipGmvFen: number;
}

/**
 * 构建近 N 天日趋势（纯函数，便于单测）：
 * 输入两表按日聚合的原始行（缺日 = 无收入），补齐连续日期窗口，缺日补 0；
 * 日期键用本地时区（与 startOfToday/todayKey 同口径），最新一天在末尾。
 */
export function buildDailyTrend(
  unlockRows: Array<{ day: string; gmv: string | number }>,
  vipRows: Array<{ day: string; gmv: string | number }>,
  days: number,
  now: Date = new Date(),
): DailyTrendPoint[] {
  const toKey = (d: Date): string => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };
  const unlockMap = new Map(unlockRows.map((r) => [r.day, Number(r.gmv) || 0]));
  const vipMap = new Map(vipRows.map((r) => [r.day, Number(r.gmv) || 0]));
  const trend: DailyTrendPoint[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = toKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i));
    trend.push({
      day: key,
      unlockGmvFen: unlockMap.get(key) ?? 0,
      vipGmvFen: vipMap.get(key) ?? 0,
    });
  }
  return trend;
}

/** 营收看板（管理端契约）：三窗口 + 在期会员数 + 累计付费用户数 + 最近订单 + 日趋势 */
export interface AdminRevenueOverview {
  windows: { today: RevenueWindow; last7d: RevenueWindow; last30d: RevenueWindow };
  /** 当前在期会员数（vip_expire_time > now） */
  vipActiveUsers: number;
  /** 累计付费用户数（任一类型有 paid 订单的去重用户） */
  paidUsers: number;
  recentOrders: Array<{
    orderId: string;
    kind: PaymentOrderKind;
    userId: string;
    amount: number;
    status: string;
    channel: string;
    updateTime: string | null;
  }>;
  /** 近 14 天日趋势（含今日，缺日补 0；纯 CSS 柱状图数据源） */
  dailyTrend: DailyTrendPoint[];
  /** 累计邀请注册数（invited_by 非空用户数；邀请裂变批次） */
  invitedUsers: number;
}

/** 读取解锁单价（分）：env 非法或未配置时回落默认值，保证恒为正整数 */
function readUnlockPriceFen(): number {
  const raw = Number(process.env.UNLOCK_PRICE_FEN);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_UNLOCK_PRICE_FEN;
}

/** 读取首单优惠价（分）：env 非法或未配置时回落默认值（快赢批次一） */
function readFirstUnlockPriceFen(): number {
  const raw = Number(process.env.FIRST_UNLOCK_PRICE_FEN);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_FIRST_UNLOCK_PRICE_FEN;
}

/** 读取会员月卡价（分）：env 非法或未配置时回落默认值 */
function readVipMonthPriceFen(): number {
  const raw = Number(process.env.VIP_MONTH_PRICE_FEN);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_VIP_MONTH_PRICE_FEN;
}

/** 读取会员首月特惠价（分）：env 非法或未配置时回落默认值 */
function readVipMonthFirstPriceFen(): number {
  const raw = Number(process.env.VIP_MONTH_FIRST_PRICE_FEN);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_VIP_MONTH_FIRST_PRICE_FEN;
}

/** 本地时区当天 0 点（营收「今日」窗口起点，与配额 todayKey 同口径） */
function startOfToday(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** 判断会员是否在期：纯函数见 membership.ts（此处不重复定义） */

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(UnlockOrderEntity)
    private readonly orderRepository: Repository<UnlockOrderEntity>,
    @InjectRepository(VipOrderEntity)
    private readonly vipOrderRepository: Repository<VipOrderEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(AiDailyUsageEntity)
    private readonly usageRepo: Repository<AiDailyUsageEntity>,
    @InjectRepository(InviteMilestoneEntity)
    private readonly milestoneRepo: Repository<InviteMilestoneEntity>,
    @Inject(PAYMENT_ADAPTER)
    private readonly paymentAdapter: PaymentAdapter,
  ) {}

  /**
   * 创建解锁订单（需登录）：
   *   - 项目不存在或归属不匹配 → 统一 404（防枚举，不区分两者）；
   *   - 项目已解锁 → { orderId: null, alreadyUnlocked: true }，不重复下单；
   *   - 通道已配置 → pending 订单 + { mode:'pay', payUrl }；
   *   - 通道未配置 → pending 订单 + { mode:'sponsor' }（不报错，前端展示赞助引导）。
   */
  async createUnlockOrder(
    userId: string | null | undefined,
    projectId: string,
    origin?: string,
  ): Promise<CreateUnlockOrderResult> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });
    // 归属校验：不存在/非本人统一 404，不泄露资源存在性
    if (!project || String(project.userId ?? '') !== String(userId ?? '')) {
      throw new HttpException('项目不存在', HttpStatus.NOT_FOUND);
    }

    if (project.unlocked === true) {
      return { orderId: null, alreadyUnlocked: true };
    }

    // 快赢批次一(QW5)首单价判定:名下无已支付订单 → 首单优惠价;否则常规价。
    // 金额只信服务端:两个价位均来自 env/默认常量,前端不传金额。
    const paidOrderCount = await this.orderRepository.count({
      where: { userId: String(userId), status: 'paid' },
    });
    const isFirstOrder = paidOrderCount === 0;
    const amount = isFirstOrder ? readFirstUnlockPriceFen() : readUnlockPriceFen();
    const order = this.orderRepository.create({
      id: randomUUID(),
      projectId: String(project.id ?? projectId),
      userId: String(userId),
      amount,
      status: 'pending',
      channel: this.paymentAdapter.name,
    });
    await this.orderRepository.save(order);

    const payment = await this.paymentAdapter.createPayment({
      id: order.id,
      amount: order.amount,
      origin,
      kind: 'unlock',
      projectId: String(project.id ?? projectId),
    });
    if (payment) {
      return { orderId: order.id, mode: 'pay', payUrl: payment.payUrl, firstOrder: isFirstOrder };
    }
    return { orderId: order.id, mode: 'sponsor', firstOrder: isFirstOrder };
  }

  /**
   * 创建会员月卡订单（需登录，商业化闭环批次）：
   *   - 用户已是在期会员仍可下单（续费叠加：paid 后到期时间 +30 天）；
   *   - 名下无 paid 会员单 → 首月特惠价（VIP_MONTH_FIRST_PRICE_FEN），否则常规价；
   *   - 金额只信服务端；通道未配置回落 sponsor 模式（与解锁单同降级语义）。
   * 会员单不设 alreadyVip 拦截 —— 续费是会员收入的重要来源，不应阻止。
   */
  async createVipOrder(
    userId: string | null | undefined,
    origin?: string,
  ): Promise<CreateVipOrderResult> {
    const user = await this.userRepository.findOne({
      where: { id: String(userId ?? '') },
    });
    if (!user) {
      throw new HttpException('用户不存在', HttpStatus.NOT_FOUND);
    }

    const paidVipCount = await this.vipOrderRepository.count({
      where: { userId: String(userId), status: 'paid' },
    });
    const isFirstOrder = paidVipCount === 0;
    const amount = isFirstOrder
      ? readVipMonthFirstPriceFen()
      : readVipMonthPriceFen();
    const order = this.vipOrderRepository.create({
      id: randomUUID(),
      userId: String(userId),
      sku: VIP_MONTH_SKU,
      amount,
      status: 'pending',
      channel: this.paymentAdapter.name,
    });
    await this.vipOrderRepository.save(order);

    const payment = await this.paymentAdapter.createPayment({
      id: order.id,
      amount: order.amount,
      origin,
      kind: 'vip',
    });
    if (payment) {
      return { orderId: order.id, mode: 'pay', payUrl: payment.payUrl, firstOrder: isFirstOrder };
    }
    return { orderId: order.id, mode: 'sponsor', firstOrder: isFirstOrder };
  }

  /**
   * 查询本人订单（需登录）：订单不存在或非本人 → 统一 404（防越权/防枚举）。
   */
  async queryOrder(
    userId: string | null | undefined,
    orderId: string,
  ): Promise<UnlockOrderView> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order || String(order.userId) !== String(userId ?? '')) {
      throw new HttpException('订单不存在', HttpStatus.NOT_FOUND);
    }
    return {
      orderId: order.id,
      projectId: String(order.projectId),
      status: order.status,
      amount: order.amount,
      channel: order.channel,
    };
  }

  /** 查询本人会员订单（需登录，归属校验同解锁单） */
  async queryVipOrder(
    userId: string | null | undefined,
    orderId: string,
  ): Promise<VipOrderView> {
    const order = await this.vipOrderRepository.findOne({
      where: { id: orderId },
    });
    if (!order || String(order.userId) !== String(userId ?? '')) {
      throw new HttpException('订单不存在', HttpStatus.NOT_FOUND);
    }
    return {
      orderId: order.id,
      sku: order.sku,
      status: order.status,
      amount: order.amount,
      channel: order.channel,
    };
  }

  /** 当前用户会员状态（需登录）：daysLeft/expiredDays 为续费提醒与到期唤醒的统一口径 */
  async getVipStatus(userId: string | null | undefined): Promise<VipStatusView> {
    const user = await this.userRepository.findOne({
      where: { id: String(userId ?? '') },
    });
    const active = isVipActive(user?.vipExpireTime);
    let daysLeft: number | null = null;
    let expiredDays: number | null = null;
    if (active && user?.vipExpireTime) {
      const diff = new Date(user.vipExpireTime).getTime() - Date.now();
      daysLeft = Math.max(1, Math.ceil(diff / (24 * 3600 * 1000)));
    } else if (!active && user?.vipExpireTime) {
      // 已过期：唤醒场景（额度已回落 3 次/日），7 天内的近期过期才值得打扰
      const diff = Date.now() - new Date(user.vipExpireTime).getTime();
      expiredDays = Math.max(1, Math.floor(diff / (24 * 3600 * 1000)));
    }
    return {
      vip: active,
      vipExpireTime:
        user?.vipExpireTime != null ? new Date(user.vipExpireTime).toISOString() : null,
      daysLeft,
      expiredDays,
    };
  }

  /**
   * 会员有效期顺延 N 天（在期从现有到期时间起算，未开通/已过期从 now 起算）。
   * 会员回调续费与邀请奖励共用同一口径，避免两处算日期漂移。
   */
  private nextVipExpire(user: Pick<UserEntity, 'vipExpireTime'>, days: number): Date {
    const now = new Date();
    const base =
      user.vipExpireTime && new Date(user.vipExpireTime).getTime() > now.getTime()
        ? new Date(user.vipExpireTime)
        : now;
    return new Date(base.getTime() + days * 24 * 3600 * 1000);
  }

  /**
   * 会员天数发放统一入口（留存与裂变加强批次）：签到连签奖励、邀请里程碑等
   * 运营侧权益都走这里 —— 顺延口径统一复用 nextVipExpire，发放即记增长事件。
   * 返回发放后的到期时间；用户不存在返回 null（调用方按旁路容错处理）。
   */
  async grantVipDays(
    userId: string,
    days: number,
    event: string,
  ): Promise<Date | null> {
    const user = await this.userRepository.findOne({
      where: { id: String(userId) },
    });
    if (!user) return null;
    user.vipExpireTime = this.nextVipExpire(user, days);
    await this.userRepository.save(user);
    this.trackPayEvent(event, {
      userId: String(userId),
      days,
      vipExpireTime: new Date(user.vipExpireTime).toISOString(),
    });
    return new Date(user.vipExpireTime);
  }

  /**
   * 阶梯邀请里程碑（留存与裂变加强批次）：累计邀请人数跨过阈值（3 人/10 人）
   * 且该档未领取过 → INSERT ON CONFLICT DO NOTHING 抢占 → 一次性加送会员天数。
   * 并发安全：唯一约束 + DO NOTHING RETURNING，天然防重复发放；
   * 未达档位直接跳过（档位按 count 升序，遇不到即止）。
   */
  private async grantInviteMilestones(inviterId: string, invitedCount: number): Promise<number> {
    let grantedDays = 0;
    for (const milestone of INVITE_MILESTONES) {
      if (invitedCount < milestone.count) break;
      try {
        const claimed: Array<unknown> = await this.milestoneRepo.query(
          `INSERT INTO invite_milestone (user_id, milestone, reward_days, create_time)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, milestone) DO NOTHING
           RETURNING milestone`,
          [String(inviterId), milestone.count, milestone.days],
        );
        if (Array.isArray(claimed) && claimed.length > 0) {
          await this.grantVipDays(String(inviterId), milestone.days, 'invite_milestone');
          grantedDays += milestone.days;
        }
      } catch (err) {
        // 里程碑是增值奖励：单档失败不影响其余档位与邀请主链路
        customLogger.log(
          `INVITE_MILESTONE_FAIL ${JSON.stringify({
            inviterId: String(inviterId),
            milestone: milestone.count,
            err: (err as Error)?.message ?? String(err),
          })}`,
          'BillingService',
        );
      }
    }
    return grantedDays;
  }

  /**
   * 邀请裂变 - 双向奖励（注册链路调用，旁路语义：内部吞错，绝不影响注册主链路）：
   *   - 邀请人：当日邀请计数 <3 时原子自增并顺延会员 +1 天
   *     （UPDATE WHERE < cap 防并发超发；无行再尝试 INSERT，冲突 = 今日已满，放弃奖励）；
   *   - 被邀请人：当日 bonus_generate +2（LEAST 3 封顶，与分享奖励同池同口径）；
   *   - 自邀请防御：邀请人与被邀请人同人直接跳过；
   *   - 记 invite_register 增长事件（漏斗：邀请 → 注册）。
   */
  async applyInviteRewards(
    inviteeId: string,
    inviteCode: string,
  ): Promise<{ inviterRewarded: boolean; welcomeGranted: boolean }> {
    const result = { inviterRewarded: false, welcomeGranted: false };
    try {
      const inviter = await this.userRepository.findOne({
        where: { inviteCode },
      });
      if (!inviter || String(inviter.id) === String(inviteeId)) {
        return result; // 邀请码无效或自邀请：静默跳过
      }
      const day = inviteDayKey();

      // ① 邀请人奖励：仅当日计数 < cap 时原子自增并返回行
      const updated: Array<unknown> = await this.usageRepo.query(
        `UPDATE ai_daily_usage SET invite_reward_count = invite_reward_count + 1, updated_at = NOW()
         WHERE user_id = $1 AND day = $2 AND invite_reward_count < $3
         RETURNING invite_reward_count`,
        [String(inviter.id), day, INVITE_REWARD_DAILY_CAP],
      );
      let withinCap = Array.isArray(updated) && updated.length > 0;
      if (!withinCap) {
        // 当日无记录 → 插入首条；冲突（已存在且已满/并发）→ 放弃奖励
        const inserted: Array<unknown> = await this.usageRepo.query(
          `INSERT INTO ai_daily_usage (user_id, day, invite_reward_count, updated_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (user_id, day) DO NOTHING
           RETURNING invite_reward_count`,
          [String(inviter.id), day],
        );
        withinCap = Array.isArray(inserted) && inserted.length > 0;
      }
      if (withinCap) {
        inviter.vipExpireTime = this.nextVipExpire(inviter, 1);
        await this.userRepository.save(inviter);
        result.inviterRewarded = true;
      }

      // ② 被邀请人欢迎礼：bonus_generate +2（与分享奖励同池，LEAST 3 封顶）
      await this.usageRepo.query(
        `INSERT INTO ai_daily_usage (user_id, day, bonus_generate, updated_at)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (user_id, day) DO UPDATE SET
           bonus_generate = LEAST(ai_daily_usage.bonus_generate + $3, 3),
           updated_at = NOW()`,
        [String(inviteeId), day, INVITE_WELCOME_BONUS],
      );
      result.welcomeGranted = true;

      // ③ 阶梯里程碑：累计邀请人数跨档时一次性加送（增量奖励，旁路）
      const invitedCount = await this.userRepository.count({
        where: { invitedBy: inviteCode },
      });
      const milestoneDays = await this.grantInviteMilestones(String(inviter.id), invitedCount);

      this.trackPayEvent('invite_register', {
        inviterId: String(inviter.id),
        inviteeId: String(inviteeId),
        inviterRewarded: result.inviterRewarded,
        invitedCount,
        milestoneDays,
      });
    } catch (err) {
      // 奖励是旁路：失败只留痕，绝不抛出影响注册
      customLogger.log(
        `INVITE_REWARD_FAIL ${JSON.stringify({
          inviteeId: String(inviteeId),
          inviteCode,
          err: (err as Error)?.message ?? String(err),
        })}`,
        'BillingService',
      );
    }
    return result;
  }

  /**
   * 邀请裂变 - 活动页数据（JWT）：
   * 存量用户首次访问懒生成邀请码（唯一冲突重试 5 次）；返回邀请码 + 战果。
   */
  async getInviteHome(userId: string | null | undefined): Promise<{
    inviteCode: string | null;
    invitedCount: number;
    /** 阶梯里程碑进度（每档是否已领取） */
    milestones: Array<{ count: number; days: number; claimed: boolean }>;
    vip: boolean;
    vipExpireTime: string | null;
  }> {
    const user = await this.userRepository.findOne({
      where: { id: String(userId ?? '') },
    });
    if (!user) {
      throw new HttpException('用户不存在', HttpStatus.NOT_FOUND);
    }
    let inviteCode = user.inviteCode ?? null;
    if (!inviteCode) {
      for (let attempt = 0; attempt < 5 && !inviteCode; attempt++) {
        const candidate = generateInviteCode();
        const clash = await this.userRepository.findOne({
          where: { inviteCode: candidate },
        });
        if (!clash) inviteCode = candidate;
      }
      if (inviteCode) {
        user.inviteCode = inviteCode;
        await this.userRepository.save(user);
      }
    }
    const invitedCount = inviteCode
      ? await this.userRepository.count({ where: { invitedBy: inviteCode } })
      : 0;
    // 阶梯里程碑进度（留存与裂变加强批次）：每档是否已领取（未达档位视为未领取）
    const milestones: Array<{ count: number; days: number; claimed: boolean }> = [];
    for (const milestone of INVITE_MILESTONES) {
      let claimed = false;
      if (invitedCount >= milestone.count) {
        try {
          const row = await this.milestoneRepo.findOne({
            where: { userId: String(user.id), milestone: milestone.count },
          });
          claimed = !!row;
        } catch {
          claimed = false; // 查询失败按未领取展示，不阻断活动页
        }
      }
      milestones.push({ count: milestone.count, days: milestone.days, claimed });
    }
    const vip = isVipActive(user.vipExpireTime);
    return {
      inviteCode,
      invitedCount,
      milestones,
      vip,
      vipExpireTime:
        vip && user.vipExpireTime ? new Date(user.vipExpireTime).toISOString() : null,
    };
  }

  /**
   * 虎皮椒支付结果回调处理（公开端点，无 JWT，安全靠验签）：
   *   - 用与下单相同的签名算法反向验证 hash，不通过 → false，绝不动库；
   *   - 订单不存在 → false（合法签名下不应出现）；
   *   - status === 'OD'（订单完成，以官方文档为准）→ 交由 dispatchPaidOrder
   *     在 unlock_order/vip_order 两表分发放行（幂等：已 paid 重复回调直接 true）；
   *   - 验签合法但状态非终态 → true（确认收到，不放行）。
   */
  async handleNotify(payload: Record<string, unknown>): Promise<boolean> {
    // 1) 验签：与下单同一 MD5 算法（xunhupaySign 会剔除 hash 与空值参数）
    const secret = process.env.XUNHU_APP_SECRET ?? '';
    const hash = String(payload?.hash ?? '').toLowerCase();
    if (!secret || !hash || xunhupaySign(payload, secret) !== hash) {
      return false; // 验签不过：绝不动库
    }

    // 2) 定位订单（trade_order_id 即我方订单号，字段名以官方文档为准）
    const orderId = String(payload.trade_order_id ?? '');
    if (!orderId) return false;

    // 3) 状态推进：仅 'OD'（订单完成）放行；金额字段不作为依据（金额只信服务端）
    if (String(payload.status ?? '') !== XUNHU_STATUS_ORDER_DONE) {
      return true;
    }

    return this.dispatchPaidOrder(
      orderId,
      payload.transaction_id != null ? String(payload.transaction_id) : null,
    );
  }

  /**
   * 模拟支付回调处理（商业化闭环批次，公开端点，安全靠 HMAC）：
   *   - mock 通道未启用（PAY_CHANNEL!=mock 或缺 MOCK_PAY_SECRET）→ 一律 false，
   *     保证生产环境（默认 xunhupay）此端点不可用；
   *   - sign 必须等于 HMAC-MD5(orderId, MOCK_PAY_SECRET)（下单时由服务端拼进
   *     payUrl，第三方无法伪造、也无法挪用到其他订单）；
   *   - 验签通过 → 与真实通道完全相同的放行语义（dispatchPaidOrder，幂等）。
   */
  async handleMockNotify(payload: Record<string, unknown>): Promise<boolean> {
    if (!mockPayEnabled()) return false;
    const orderId = String(payload?.orderId ?? '');
    const sign = String(payload?.sign ?? '');
    if (!orderId || !sign) return false;
    const secret = process.env.MOCK_PAY_SECRET as string;
    if (mockPaySign(orderId, secret) !== sign) return false;
    return this.dispatchPaidOrder(orderId, `mock:${orderId.slice(0, 8)}`);
  }

  /**
   * 放行分发（两通道共用）：按订单号在 unlock_order / vip_order 两表查找，
   * 已 paid 直接 true（幂等）；置 paid 后按订单类型落权益：
   *   - unlock：project.unlocked = true（先 order 后 project，一致性靠幂等兜底）；
   *   - vip：user.vip_expire_time 叠加 +30 天（未到期 = 现有到期时间起算，已过期 = now 起算）。
   * 两表都查不到 → false（合法签名下不应出现）。
   */
  private async dispatchPaidOrder(
    orderId: string,
    channelOrderNo: string | null,
  ): Promise<boolean> {
    // ① 解锁单
    const unlockOrder = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (unlockOrder) {
      if (unlockOrder.status === 'paid') return true; // 幂等：不再改库、不再记事件
      unlockOrder.status = 'paid';
      unlockOrder.channelOrderNo = channelOrderNo;
      await this.orderRepository.save(unlockOrder); // 先 order 后 project

      const project = await this.projectRepository.findOne({
        where: { id: unlockOrder.projectId },
      });
      if (project) {
        project.unlocked = true;
        await this.projectRepository.save(project);
      }

      // 快赢批次一:标记本次是否用户首笔支付(不含本单的其他 paid 订单数为 0),
      // 供漏斗分析区分「首单转化率」与「复购率」两个指标。
      const otherPaidCount = await this.orderRepository.count({
        where: { userId: unlockOrder.userId, status: 'paid' },
      });
      // 注:此刻本单已置 paid,故首单判定为「其他 paid 计数 ≤ 1」(即只有本单自己)
      const isFirstOrder = otherPaidCount <= 1;

      this.trackPayEvent('unlock_pay', {
        userId: unlockOrder.userId,
        orderId: unlockOrder.id,
        amount: unlockOrder.amount,
        projectId: String(unlockOrder.projectId),
        firstOrder: isFirstOrder,
      });
      return true;
    }

    // ② 会员单
    const vipOrder = await this.vipOrderRepository.findOne({
      where: { id: orderId },
    });
    if (vipOrder) {
      if (vipOrder.status === 'paid') return true; // 幂等
      vipOrder.status = 'paid';
      vipOrder.channelOrderNo = channelOrderNo;
      await this.vipOrderRepository.save(vipOrder); // 先 order 后权益

      const user = await this.userRepository.findOne({
        where: { id: vipOrder.userId },
      });
      if (user) {
        // 叠加规则:当前在期 → 在现有到期时间上 +30 天(续费不丢剩余天数);
        //          已过期/首购 → 从 now 起算（口径统一收敛在 nextVipExpire）。
        user.vipExpireTime = this.nextVipExpire(user, VIP_MONTH_DAYS);
        await this.userRepository.save(user);
      }

      const paidVipCount = await this.vipOrderRepository.count({
        where: { userId: vipOrder.userId, status: 'paid' },
      });
      this.trackPayEvent('vip_pay', {
        userId: vipOrder.userId,
        orderId: vipOrder.id,
        amount: vipOrder.amount,
        sku: vipOrder.sku,
        firstOrder: paidVipCount <= 1,
        vipExpireTime: user?.vipExpireTime
          ? new Date(user.vipExpireTime).toISOString()
          : null,
      });
      return true;
    }

    return false;
  }

  /** 增长事件：统一 GROWTH_EVENT 格式（与 GrowthEventService 同格式，直接写日志避免模块依赖） */
  private trackPayEvent(event: string, extra: Record<string, unknown>): void {
    customLogger.log(
      `GROWTH_EVENT ${JSON.stringify({
        event,
        ts: new Date().toISOString(),
        ...extra,
      })}`,
      'BillingService',
    );
  }

  /**
   * 营收看板汇总（管理端，商业化闭环批次）：
   * 三窗口（今日/7 日/30 日）解锁与会员各自的订单数 + GMV（分），
   * 在期会员数、累计付费用户数（两表 paid 去重），最近 20 笔订单明细。
   * 窗口按订单 update_time（= 支付完成时间）统计，与增长日志口径一致；
   * 单库单表聚合，数据量增长后可再加日期分桶或物化视图。
   */
  async getAdminOverview(): Promise<AdminRevenueOverview> {
    const now = new Date();
    const starts: Record<'today' | 'last7d' | 'last30d', Date> = {
      today: startOfToday(now),
      last7d: new Date(now.getTime() - 7 * 24 * 3600 * 1000),
      last30d: new Date(now.getTime() - 30 * 24 * 3600 * 1000),
    };

    const windowStat = async (
      repo: Repository<UnlockOrderEntity | VipOrderEntity>,
      start: Date,
    ): Promise<{ count: number; gmv: number }> => {
      const row = await repo
        .createQueryBuilder('o')
        .select('COUNT(*)', 'count')
        .addSelect('COALESCE(SUM(o.amount), 0)', 'gmv')
        .where("o.status = 'paid'")
        .andWhere('o.update_time >= :start', { start })
        .getRawOne<{ count: string; gmv: string }>();
      return { count: Number(row?.count ?? 0), gmv: Number(row?.gmv ?? 0) };
    };

    const windows = {} as AdminRevenueOverview['windows'];
    for (const [key, start] of Object.entries(starts) as Array<
      ['today' | 'last7d' | 'last30d', Date]
    >) {
      const unlock = await windowStat(this.orderRepository, start);
      const vip = await windowStat(this.vipOrderRepository, start);
      windows[key] = {
        unlockOrders: unlock.count,
        unlockGmvFen: unlock.gmv,
        vipOrders: vip.count,
        vipGmvFen: vip.gmv,
      };
    }

    // 累计付费用户：两表 paid 去重 userId 取并集（数据量可控，直接拉 id 列去重）
    const [unlockUsers, vipUsers] = await Promise.all([
      this.orderRepository
        .createQueryBuilder('o')
        .select('DISTINCT o.user_id', 'uid')
        .where("o.status = 'paid'")
        .getRawMany<{ uid: string }>(),
      this.vipOrderRepository
        .createQueryBuilder('o')
        .select('DISTINCT o.user_id', 'uid')
        .where("o.status = 'paid'")
        .getRawMany<{ uid: string }>(),
    ]);
    const paidUserSet = new Set<string>();
    for (const row of [...unlockUsers, ...vipUsers]) {
      if (row?.uid) paidUserSet.add(String(row.uid));
    }

    // 日趋势：近 14 天双表按日聚合（只计 paid；PG 允许 GROUP BY/ORDER BY 输出列别名）
    const TREND_DAYS = 14;
    const trendStart = new Date(now.getTime() - (TREND_DAYS - 1) * 24 * 3600 * 1000);
    trendStart.setHours(0, 0, 0, 0);
    const dailyAgg = async (
      repo: Repository<UnlockOrderEntity | VipOrderEntity>,
    ): Promise<Array<{ day: string; gmv: string }>> =>
      repo
        .createQueryBuilder('o')
        .select("to_char(o.update_time, 'YYYY-MM-DD')", 'day')
        .addSelect('COALESCE(SUM(o.amount), 0)', 'gmv')
        .where("o.status = 'paid'")
        .andWhere('o.update_time >= :start', { start: trendStart })
        .groupBy('day')
        .orderBy('day')
        .getRawMany<{ day: string; gmv: string }>();
    const [unlockDaily, vipDaily] = await Promise.all([
      dailyAgg(this.orderRepository),
      dailyAgg(this.vipOrderRepository),
    ]);
    const dailyTrend = buildDailyTrend(unlockDaily, vipDaily, TREND_DAYS, now);

    const vipActiveUsers = await this.userRepository
      .createQueryBuilder('u')
      .where('u.vip_expire_time IS NOT NULL')
      .andWhere('u.vip_expire_time > :now', { now })
      .getCount();

    // 邀请裂变：累计邀请注册数（invited_by 非空）
    const invitedUsers = await this.userRepository
      .createQueryBuilder('u')
      .where('u.invited_by IS NOT NULL')
      .getCount();

    // 最近订单：两表各取最近 20 合并排序截断（避免 UNION 原生 SQL 的类型噪音）
    const [recentUnlock, recentVip] = await Promise.all([
      this.orderRepository.find({ order: { update_time: 'DESC' }, take: 20 }),
      this.vipOrderRepository.find({ order: { update_time: 'DESC' }, take: 20 }),
    ]);
    const recentOrders: AdminRevenueOverview['recentOrders'] = [
      ...recentUnlock.map((o) => ({
        orderId: o.id,
        kind: 'unlock' as const,
        userId: o.userId,
        amount: o.amount,
        status: o.status,
        channel: o.channel,
        updateTime: o.update_time ? new Date(o.update_time).toISOString() : null,
      })),
      ...recentVip.map((o) => ({
        orderId: o.id,
        kind: 'vip' as const,
        userId: o.userId,
        amount: o.amount,
        status: o.status,
        channel: o.channel,
        updateTime: o.update_time ? new Date(o.update_time).toISOString() : null,
      })),
    ]
      .sort((a, b) => (b.updateTime ?? '').localeCompare(a.updateTime ?? ''))
      .slice(0, 20);

    return { windows, vipActiveUsers, paidUsers: paidUserSet.size, recentOrders, dailyTrend, invitedUsers };
  }
}
