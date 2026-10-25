// 语图 Task 6 - 按次付费解锁服务
// 状态机：unlock_order.status 单向 pending → paid（无退款流）；project.unlocked 单向 false → true。
// 支付安全四原则：
//   1) 验签不过不动库 —— 回调先用与下单相同的 MD5 算法验签，失败直接返回 false；
//   2) 归属校验防越权 —— 下单/查单均校验资源归属，不匹配统一 404 防枚举；
//   3) 金额只信服务端 —— amount 取自 env UNLOCK_PRICE_FEN，回调中的金额字段不作为放行依据；
//   4) 回调幂等 —— 已 paid 的订单收到重复回调直接确认（true），不再改库、不再记增长事件。
import { randomUUID } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { customLogger } from '../utils/log/logger.service';
import { ProjectEntity } from '../operationalModules/projectManager/entities/project_manager.entity';
import { UnlockOrderEntity } from './entities/unlock_order.entity';
import { XunhupayAdapter, xunhupaySign } from './adapters/xunhupay.adapter';

/** 默认解锁价格（单位：分，1.90 元）；可用 env UNLOCK_PRICE_FEN 覆盖 */
const DEFAULT_UNLOCK_PRICE_FEN = 190;

/** 虎皮椒回调中表示订单已支付完成的状态值（以官方文档为准，接入时需人工比对） */
const XUNHU_STATUS_ORDER_DONE = 'OD';

/** 下单结果（前端契约）：pay = 跳转支付；sponsor = 通道未配置走赞助引导 */
export interface CreateUnlockOrderResult {
  orderId: string | null;
  mode?: 'pay' | 'sponsor';
  payUrl?: string;
  alreadyUnlocked?: boolean;
}

/** 订单查询结果（前端契约） */
export interface UnlockOrderView {
  orderId: string;
  projectId: string;
  status: 'pending' | 'paid';
  amount: number;
  channel: string;
}

/** 读取解锁单价（分）：env 非法或未配置时回落默认值，保证恒为正整数 */
function readUnlockPriceFen(): number {
  const raw = Number(process.env.UNLOCK_PRICE_FEN);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_UNLOCK_PRICE_FEN;
}

@Injectable()
export class BillingService {
  constructor(
    @InjectRepository(UnlockOrderEntity)
    private readonly orderRepository: Repository<UnlockOrderEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    private readonly paymentAdapter: XunhupayAdapter,
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

    // 金额只信服务端：UNLOCK_PRICE_FEN 定价，前端不传金额
    const amount = readUnlockPriceFen();
    const order = this.orderRepository.create({
      id: randomUUID(),
      projectId: String(project.id ?? projectId),
      userId: String(userId),
      amount,
      status: 'pending',
      channel: 'xunhupay',
    });
    await this.orderRepository.save(order);

    const payment = await this.paymentAdapter.createPayment({
      id: order.id,
      amount: order.amount,
      origin,
    });
    if (payment) {
      return { orderId: order.id, mode: 'pay', payUrl: payment.payUrl };
    }
    return { orderId: order.id, mode: 'sponsor' };
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

  /**
   * 虎皮椒支付结果回调处理（公开端点，无 JWT，安全靠验签）：
   *   - 用与下单相同的签名算法反向验证 hash，不通过 → false，绝不动库；
   *   - 订单不存在 → false（合法签名下不应出现）；
   *   - status === 'OD'（订单完成，以官方文档为准）→ 订单置 paid + 回填通道单号，
   *     project.unlocked = true（先 order 后 project 顺序 save；未注入事务管理器，
   *     一致性靠幂等回调兜底：重复回调会重新执行剩余半步）；
   *   - 已 paid 的重复回调 → 直接 true（幂等：不再改库、不再记增长事件）；
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
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) return false;

    // 3) 幂等：已 paid 的重复回调直接确认，不再改库、不再记事件
    if (order.status === 'paid') return true;

    // 4) 状态推进：仅 'OD'（订单完成）放行；金额字段不作为依据（金额只信服务端）
    if (String(payload.status ?? '') !== XUNHU_STATUS_ORDER_DONE) {
      return true;
    }

    order.status = 'paid';
    order.channelOrderNo =
      payload.transaction_id != null ? String(payload.transaction_id) : null;
    await this.orderRepository.save(order); // 先 order 后 project

    const project = await this.projectRepository.findOne({
      where: { id: order.projectId },
    });
    if (project) {
      project.unlocked = true;
      await this.projectRepository.save(project);
    }

    // 增长事件：统一 GROWTH_EVENT 格式（与 GrowthEventService 同格式，直接写日志避免模块依赖）
    customLogger.log(
      `GROWTH_EVENT ${JSON.stringify({
        event: 'unlock_pay',
        ts: new Date().toISOString(),
        userId: order.userId,
        projectId: String(order.projectId),
        orderId: order.id,
        amount: order.amount,
      })}`,
      'BillingService',
    );
    return true;
  }
}
