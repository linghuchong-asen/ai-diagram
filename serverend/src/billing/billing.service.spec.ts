// 语图 Task 6：按次付费解锁服务单测（纯逻辑直测，mock 仓库/适配器，不起 Nest TestingModule）
// 商业化闭环批次扩展：会员月卡下单/回调续费叠加/模拟通道验签/营收看板口径
import { HttpStatus } from '@nestjs/common';
import { BillingService, buildDailyTrend, isVipActive } from './billing.service';
import { xunhupaySign } from './adapters/xunhupay.adapter';
import { mockPaySign } from './adapters/mock-pay.adapter';
import { customLogger } from '../utils/log/logger.service';
import type { UnlockOrderEntity } from './entities/unlock_order.entity';
import type { VipOrderEntity } from './entities/vip_order.entity';

/** 仓库桩：service 用 findOne / save / delete / create / count / query 六个方法 */
function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((x: Partial<UnlockOrderEntity | VipOrderEntity>) => x),
    count: jest.fn(),
    query: jest.fn(),
    createQueryBuilder: jest.fn(),
  };
}

/** 适配器桩：createPayment 返回 null 模拟未配置，返回 { payUrl } 模拟已配置 */
function makeAdapter() {
  return { name: 'xunhupay', createPayment: jest.fn() };
}

function makeService() {
  const orderRepo = makeRepo();
  const vipOrderRepo = makeRepo();
  const projectRepo = makeRepo();
  const userRepo = makeRepo();
  const usageRepo = makeRepo();
  const milestoneRepo = makeRepo();
  const adapter = makeAdapter();
  // 快赢批次一默认桩:名下已有 1 笔 paid 订单 → 非首单,走常规价 190(与旧行为一致)
  orderRepo.count.mockResolvedValue(1);
  const service = new BillingService(
    orderRepo as never,
    vipOrderRepo as never,
    projectRepo as never,
    userRepo as never,
    usageRepo as never,
    milestoneRepo as never,
    adapter as never,
  );
  return { service, orderRepo, vipOrderRepo, projectRepo, userRepo, usageRepo, milestoneRepo, adapter };
}

/** 本套件涉及的 env 键（读写后还原，避免用例间串扰） */
const ENV_KEYS = [
  'UNLOCK_PRICE_FEN',
  'FIRST_UNLOCK_PRICE_FEN',
  'VIP_MONTH_PRICE_FEN',
  'VIP_MONTH_FIRST_PRICE_FEN',
  'XUNHU_APP_SECRET',
  'PAY_CHANNEL',
  'MOCK_PAY_SECRET',
] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  jest.restoreAllMocks();
});

describe('BillingService（Task 6：按次付费解锁）', () => {
  describe('createUnlockOrder（下单）', () => {
    it('项目不存在 → 404 统一文案（防枚举），不建订单不调支付', async () => {
      const { service, projectRepo, orderRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue(null);
      await expect(service.createUnlockOrder('u1', '999')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        message: '项目不存在',
      });
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(adapter.createPayment).not.toHaveBeenCalled();
    });

    it('项目归属他人 → 同样 404（不区分不存在/无权，防枚举）', async () => {
      const { service, projectRepo, orderRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'owner-b' });
      await expect(service.createUnlockOrder('owner-a', '1')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        message: '项目不存在',
      });
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(adapter.createPayment).not.toHaveBeenCalled();
    });

    it('项目已解锁 → 直接返回 alreadyUnlocked，不重复下单', async () => {
      const { service, projectRepo, orderRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: true });
      await expect(service.createUnlockOrder('u1', '1')).resolves.toEqual({
        orderId: null,
        alreadyUnlocked: true,
      });
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(adapter.createPayment).not.toHaveBeenCalled();
    });

    it('未配置 UNLOCK_PRICE_FEN → 金额默认 190 分，订单 pending', async () => {
      const { service, projectRepo, orderRepo } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      const result = await service.createUnlockOrder('u1', '1');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 190,
          status: 'pending',
          channel: 'xunhupay',
          userId: 'u1',
          projectId: '1',
        }),
      );
      expect(orderRepo.save).toHaveBeenCalled();
      expect(result.orderId).toEqual(expect.stringMatching(/^[0-9a-f-]{36}$/));
    });

    it('配置 UNLOCK_PRICE_FEN=990 → 金额取 env 值', async () => {
      const { service, projectRepo, orderRepo } = makeService();
      process.env.UNLOCK_PRICE_FEN = '990';
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      await service.createUnlockOrder('u1', '1');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 990 }),
      );
    });

    it('快赢批次一:名下无 paid 订单（首单）→ 默认 90 分 + firstOrder:true', async () => {
      const { service, projectRepo, orderRepo } = makeService();
      orderRepo.count.mockResolvedValue(0);
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      const result = await service.createUnlockOrder('u1', '1');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 90 }),
      );
      expect(result.firstOrder).toBe(true);
      // 首单判定按「本人 + 已支付」维度查询
      expect(orderRepo.count).toHaveBeenCalledWith({
        where: { userId: 'u1', status: 'paid' },
      });
    });

    it('快赢批次一:首单价可被 FIRST_UNLOCK_PRICE_FEN 覆盖', async () => {
      const { service, projectRepo, orderRepo } = makeService();
      process.env.FIRST_UNLOCK_PRICE_FEN = '50';
      orderRepo.count.mockResolvedValue(0);
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      await service.createUnlockOrder('u1', '1');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 50 }),
      );
    });

    it('快赢批次一:已有 paid 订单（非首单）→ 常规价 190 + firstOrder:false', async () => {
      const { service, projectRepo, orderRepo } = makeService();
      orderRepo.count.mockResolvedValue(2);
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      const result = await service.createUnlockOrder('u1', '1');
      expect(orderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 190 }),
      );
      expect(result.firstOrder).toBe(false);
    });

    it('通道未配置（adapter 返回 null）→ mode:sponsor，不报错', async () => {
      const { service, projectRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      adapter.createPayment.mockResolvedValue(null);
      await expect(service.createUnlockOrder('u1', '1')).resolves.toEqual({
        orderId: expect.any(String),
        mode: 'sponsor',
        firstOrder: false,
      });
    });

    it('通道已配置（adapter 返回 payUrl）→ mode:pay 带 payUrl', async () => {
      const { service, projectRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      adapter.createPayment.mockResolvedValue({ payUrl: 'https://api.xunhupay.com/payment/do.html?xxx' });
      await expect(service.createUnlockOrder('u1', '1', 'http://localhost:5173')).resolves.toEqual({
        orderId: expect.any(String),
        mode: 'pay',
        payUrl: 'https://api.xunhupay.com/payment/do.html?xxx',
        firstOrder: false,
      });
      // origin 透传给适配器（用于支付完成回跳）
      expect(adapter.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ origin: 'http://localhost:5173', amount: 190 }),
      );
    });
  });

  describe('queryOrder（查单）', () => {
    it('订单不存在 → 404', async () => {
      const { service, orderRepo } = makeService();
      orderRepo.findOne.mockResolvedValue(null);
      await expect(service.queryOrder('u1', 'o1')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('越权查他人订单 → 统一 404（不区分不存在/无权）', async () => {
      const { service, orderRepo } = makeService();
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        projectId: '1',
        userId: 'owner-b',
        amount: 190,
        status: 'paid',
        channel: 'xunhupay',
      });
      await expect(service.queryOrder('owner-a', 'o1')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
        message: '订单不存在',
      });
    });

    it('本人订单 → 返回订单视图五字段', async () => {
      const { service, orderRepo } = makeService();
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        projectId: '1',
        userId: 'u1',
        amount: 190,
        status: 'paid',
        channel: 'xunhupay',
      });
      await expect(service.queryOrder('u1', 'o1')).resolves.toEqual({
        orderId: 'o1',
        projectId: '1',
        status: 'paid',
        amount: 190,
        channel: 'xunhupay',
      });
    });
  });

  describe('handleNotify（支付回调）', () => {
    /** 构造一份验签合法的回调 payload */
    function signedPayload(secret: string, overrides?: Record<string, unknown>) {
      const payload: Record<string, string> = {
        trade_order_id: 'o1',
        transaction_id: 'tx-1',
        status: 'OD',
        total_fee: '1.90',
        ...overrides,
      } as Record<string, string>;
      payload.hash = xunhupaySign(payload, secret);
      return payload;
    }

    it('验签失败 → 返回 false，绝不动库（连订单都不查）', async () => {
      const { service, orderRepo, projectRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      const forged = signedPayload('wrong-secret');
      await expect(service.handleNotify(forged)).resolves.toBe(false);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(projectRepo.save).not.toHaveBeenCalled();
    });

    it('未配置 XUNHU_APP_SECRET → 一律验签失败（不动库）', async () => {
      const { service, orderRepo } = makeService();
      const payload = signedPayload('some-secret');
      await expect(service.handleNotify(payload)).resolves.toBe(false);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
    });

    it('验签成功 + status=OD → 订单置 paid、项目解锁、记一次 GROWTH_EVENT', async () => {
      const { service, orderRepo, projectRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        projectId: '1',
        userId: 'u1',
        amount: 190,
        status: 'pending',
        channel: 'xunhupay',
      });
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      const spy = jest.spyOn(customLogger, 'log');

      await expect(service.handleNotify(signedPayload('real-secret'))).resolves.toBe(true);

      // 先 order 后 project：订单置 paid + 回填通道单号，项目置 unlocked
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'o1', status: 'paid', channelOrderNo: 'tx-1' }),
      );
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: '1', unlocked: true }),
      );
      // 增长事件：统一 GROWTH_EVENT 格式，含四要素
      expect(spy).toHaveBeenCalledTimes(1);
      const msg = String(spy.mock.calls[0][0]);
      expect(msg.startsWith('GROWTH_EVENT ')).toBe(true);
      expect(JSON.parse(msg.replace(/^GROWTH_EVENT /, ''))).toEqual(
        expect.objectContaining({
          event: 'unlock_pay',
          userId: 'u1',
          projectId: '1',
          orderId: 'o1',
          amount: 190,
        }),
      );
    });

    it('重复回调（订单已 paid）→ 幂等返回 true，不再改库、不再记事件', async () => {
      const { service, orderRepo, projectRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        projectId: '1',
        userId: 'u1',
        amount: 190,
        status: 'paid',
        channel: 'xunhupay',
        channelOrderNo: 'tx-1',
      });
      const spy = jest.spyOn(customLogger, 'log');

      await expect(service.handleNotify(signedPayload('real-secret'))).resolves.toBe(true);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(projectRepo.findOne).not.toHaveBeenCalled();
      expect(projectRepo.save).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('验签合法但状态非 OD → 确认收到（true）但不放行解锁', async () => {
      const { service, orderRepo, projectRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue({
        id: 'o1',
        projectId: '1',
        userId: 'u1',
        amount: 190,
        status: 'pending',
        channel: 'xunhupay',
      });
      await expect(
        service.handleNotify(signedPayload('real-secret', { status: 'WAIT' })),
      ).resolves.toBe(true);
      expect(orderRepo.save).not.toHaveBeenCalled();
      expect(projectRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('createVipOrder（会员月卡下单，商业化闭环批次）', () => {
    it('用户不存在 → 404（JWT 之外的防御）', async () => {
      const { service, userRepo } = makeService();
      userRepo.findOne.mockResolvedValue(null);
      await expect(service.createVipOrder('ghost')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('首张会员单 → 首月特惠价 590 分 + firstOrder:true', async () => {
      const { service, userRepo, vipOrderRepo, adapter } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'u1' });
      vipOrderRepo.count.mockResolvedValue(0);
      const result = await service.createVipOrder('u1');
      expect(vipOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 590,
          sku: 'vip_month',
          status: 'pending',
          channel: 'xunhupay',
        }),
      );
      expect(result.firstOrder).toBe(true);
      expect(adapter.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'vip' }),
      );
    });

    it('非首张会员单（复购）→ 常规价 990 分 + firstOrder:false', async () => {
      const { service, userRepo, vipOrderRepo } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'u1' });
      vipOrderRepo.count.mockResolvedValue(1);
      const result = await service.createVipOrder('u1');
      expect(vipOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 990 }),
      );
      expect(result.firstOrder).toBe(false);
    });

    it('价位可被 VIP_MONTH_PRICE_FEN / VIP_MONTH_FIRST_PRICE_FEN 覆盖', async () => {
      const { service, userRepo, vipOrderRepo } = makeService();
      process.env.VIP_MONTH_PRICE_FEN = '1200';
      process.env.VIP_MONTH_FIRST_PRICE_FEN = '100';
      userRepo.findOne.mockResolvedValue({ id: 'u1' });
      vipOrderRepo.count.mockResolvedValue(0);
      await service.createVipOrder('u1');
      expect(vipOrderRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ amount: 100 }),
      );
    });

    it('通道未配置 → mode:sponsor 降级，不报错', async () => {
      const { service, userRepo, vipOrderRepo, adapter } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'u1' });
      vipOrderRepo.count.mockResolvedValue(1);
      adapter.createPayment.mockResolvedValue(null);
      await expect(service.createVipOrder('u1')).resolves.toEqual({
        orderId: expect.any(String),
        mode: 'sponsor',
        firstOrder: false,
      });
    });
  });

  describe('queryVipOrder / getVipStatus', () => {
    it('越权查他人会员单 → 统一 404', async () => {
      const { service, vipOrderRepo } = makeService();
      vipOrderRepo.findOne.mockResolvedValue({
        id: 'v1', userId: 'owner-b', sku: 'vip_month', amount: 990, status: 'paid', channel: 'xunhupay',
      });
      await expect(service.queryVipOrder('owner-a', 'v1')).rejects.toMatchObject({
        status: HttpStatus.NOT_FOUND,
      });
    });

    it('getVipStatus：在期 → daysLeft ≥1；近期过期 → expiredDays 唤醒口径；未开通 → 全 null', async () => {
      const { service, userRepo } = makeService();
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        vipExpireTime: new Date(Date.now() + 86_400_000),
      });
      const active = await service.getVipStatus('u1');
      expect(active.vip).toBe(true);
      expect(active.vipExpireTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // 续费提醒口径（vip-renewal-reminder-batch）：在期剩余 ceil ≥1 天
      expect(active.daysLeft).toBeGreaterThanOrEqual(1);
      expect(active.expiredDays).toBeNull();

      // 已过期（到期横幅唤醒口径）：时间仍回传（供前端计算），expiredDays floor ≥1
      userRepo.findOne.mockResolvedValue({
        id: 'u1',
        vipExpireTime: new Date(Date.now() - 3 * 86_400_000),
      });
      const expired = await service.getVipStatus('u1');
      expect(expired.vip).toBe(false);
      expect(expired.daysLeft).toBeNull();
      expect(expired.expiredDays).toBe(3);
      expect(expired.vipExpireTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);

      userRepo.findOne.mockResolvedValue(null);
      expect(await service.getVipStatus('u1')).toEqual({
        vip: false,
        vipExpireTime: null,
        daysLeft: null,
        expiredDays: null,
      });
    });

    it('isVipActive 纯函数：null/过去 → false；未来 → true', () => {
      expect(isVipActive(null)).toBe(false);
      expect(isVipActive(undefined)).toBe(false);
      expect(isVipActive(new Date(Date.now() - 1000))).toBe(false);
      expect(isVipActive(new Date(Date.now() + 1000))).toBe(true);
    });
  });

  describe('回调放行分发（unlock_order / vip_order 两表）', () => {
    /** 构造验签合法回调（unlock_order 未命中场景走 vip 分支） */
    function signedPayload(secret: string, orderId: string, overrides?: Record<string, unknown>) {
      const payload: Record<string, string> = {
        trade_order_id: orderId,
        transaction_id: 'tx-9',
        status: 'OD',
        ...overrides,
      } as Record<string, string>;
      payload.hash = xunhupaySign(payload, secret);
      return payload;
    }

    it('unlock_order 未命中 → vip_order 命中：订单置 paid + 会员到期 +30 天 + vip_pay 事件', async () => {
      const { service, orderRepo, vipOrderRepo, userRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue(null);
      vipOrderRepo.findOne.mockResolvedValue({
        id: 'v1', userId: 'u1', sku: 'vip_month', amount: 590, status: 'pending', channel: 'xunhupay',
      });
      userRepo.findOne.mockResolvedValue({ id: 'u1', vipExpireTime: null });
      vipOrderRepo.count.mockResolvedValue(1);
      const spy = jest.spyOn(customLogger, 'log');

      await expect(service.handleNotify(signedPayload('real-secret', 'v1'))).resolves.toBe(true);

      expect(vipOrderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'v1', status: 'paid', channelOrderNo: 'tx-9' }),
      );
      // 首购：从 now 起算 +30 天（允许 2 秒时钟误差）
      const saved: any = userRepo.save.mock.calls[0][0];
      expect(saved.vipExpireTime.getTime()).toBeGreaterThan(Date.now() + 29.9 * 86_400_000);
      const msg = String(spy.mock.calls[0][0]);
      expect(JSON.parse(msg.replace(/^GROWTH_EVENT /, ''))).toEqual(
        expect.objectContaining({ event: 'vip_pay', orderId: 'v1', amount: 590, firstOrder: true }),
      );
    });

    it('在期会员续费 → 从「现有到期时间」起 +30 天（不丢剩余天数）', async () => {
      const { service, orderRepo, vipOrderRepo, userRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue(null);
      vipOrderRepo.findOne.mockResolvedValue({
        id: 'v2', userId: 'u1', sku: 'vip_month', amount: 990, status: 'pending', channel: 'xunhupay',
      });
      const oldExpire = new Date(Date.now() + 10 * 86_400_000);
      userRepo.findOne.mockResolvedValue({ id: 'u1', vipExpireTime: oldExpire });
      vipOrderRepo.count.mockResolvedValue(2);

      await expect(service.handleNotify(signedPayload('real-secret', 'v2'))).resolves.toBe(true);

      const saved: any = userRepo.save.mock.calls[0][0];
      expect(saved.vipExpireTime.getTime()).toBeGreaterThan(Date.now() + 39.9 * 86_400_000);
    });

    it('已 paid 的会员单重复回调 → 幂等 true，不改库不记事件', async () => {
      const { service, orderRepo, vipOrderRepo, userRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue(null);
      vipOrderRepo.findOne.mockResolvedValue({
        id: 'v1', userId: 'u1', sku: 'vip_month', amount: 590, status: 'paid', channel: 'xunhupay',
      });
      const spy = jest.spyOn(customLogger, 'log');
      await expect(service.handleNotify(signedPayload('real-secret', 'v1'))).resolves.toBe(true);
      expect(userRepo.save).not.toHaveBeenCalled();
      expect(spy).not.toHaveBeenCalled();
    });

    it('两表都未命中 → false（合法签名下不应出现）', async () => {
      const { service, orderRepo, vipOrderRepo } = makeService();
      process.env.XUNHU_APP_SECRET = 'real-secret';
      orderRepo.findOne.mockResolvedValue(null);
      vipOrderRepo.findOne.mockResolvedValue(null);
      await expect(service.handleNotify(signedPayload('real-secret', 'ghost'))).resolves.toBe(false);
    });
  });

  describe('handleMockNotify（模拟支付通道，商业化闭环批次）', () => {
    it('PAY_CHANNEL 未配置为 mock → 一律 false（生产端点不可用）', async () => {
      const { service, orderRepo } = makeService();
      delete process.env.PAY_CHANNEL;
      process.env.MOCK_PAY_SECRET = 'msecret';
      await expect(
        service.handleMockNotify({ orderId: 'o1', sign: mockPaySign('o1', 'msecret') }),
      ).resolves.toBe(false);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
    });

    it('PAY_CHANNEL=mock 但缺 MOCK_PAY_SECRET → false（防裸奔）', async () => {
      const { service } = makeService();
      process.env.PAY_CHANNEL = 'mock';
      delete process.env.MOCK_PAY_SECRET;
      await expect(
        service.handleMockNotify({ orderId: 'o1', sign: 'whatever' }),
      ).resolves.toBe(false);
    });

    it('签名伪造 → false 不动库', async () => {
      const { service, orderRepo, vipOrderRepo } = makeService();
      process.env.PAY_CHANNEL = 'mock';
      process.env.MOCK_PAY_SECRET = 'msecret';
      await expect(
        service.handleMockNotify({ orderId: 'o1', sign: 'bad-sign' }),
      ).resolves.toBe(false);
      expect(orderRepo.findOne).not.toHaveBeenCalled();
      expect(vipOrderRepo.findOne).not.toHaveBeenCalled();
    });

    it('验签通过 → 解锁单放行（与真实通道同一 dispatch 语义）', async () => {
      const { service, orderRepo, projectRepo } = makeService();
      process.env.PAY_CHANNEL = 'mock';
      process.env.MOCK_PAY_SECRET = 'msecret';
      orderRepo.findOne.mockResolvedValue({
        id: 'o1', projectId: '1', userId: 'u1', amount: 190, status: 'pending', channel: 'mock',
      });
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });

      await expect(
        service.handleMockNotify({ orderId: 'o1', sign: mockPaySign('o1', 'msecret') }),
      ).resolves.toBe(true);
      expect(orderRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'paid' }),
      );
      expect(projectRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ unlocked: true }),
      );
    });

    it('验签通过 + 幂等：已 paid 的会员单重复模拟回调 → true 不改库', async () => {
      const { service, orderRepo, vipOrderRepo, userRepo } = makeService();
      process.env.PAY_CHANNEL = 'mock';
      process.env.MOCK_PAY_SECRET = 'msecret';
      orderRepo.findOne.mockResolvedValue(null);
      vipOrderRepo.findOne.mockResolvedValue({
        id: 'v1', userId: 'u1', sku: 'vip_month', amount: 590, status: 'paid', channel: 'mock',
      });
      await expect(
        service.handleMockNotify({ orderId: 'v1', sign: mockPaySign('v1', 'msecret') }),
      ).resolves.toBe(true);
      expect(userRepo.save).not.toHaveBeenCalled();
    });
  });

  describe('applyInviteRewards / getInviteHome（邀请裂变批次）', () => {
    it('有效邀请：邀请人 +1 天会员 + 被邀请人欢迎礼 + invite_register 事件', async () => {
      const { service, userRepo, usageRepo } = makeService();
      userRepo.findOne.mockResolvedValueOnce({
        id: 'inviter', inviteCode: 'ABCD2345', vipExpireTime: null,
      });
      // ① 日上限 UPDATE 命中（RETURNING 有行）② 欢迎礼 INSERT
      usageRepo.query
        .mockResolvedValueOnce([{ invite_reward_count: 1 }])
        .mockResolvedValueOnce([]);
      const spy = jest.spyOn(customLogger, 'log');

      const result = await service.applyInviteRewards('invitee', 'ABCD2345');
      expect(result).toEqual({ inviterRewarded: true, welcomeGranted: true });
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'inviter', vipExpireTime: expect.any(Date) }),
      );
      const inviteMsg = spy.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('"invite_register"'));
      expect(inviteMsg).toBeDefined();
      expect(JSON.parse(String(inviteMsg).replace(/^GROWTH_EVENT /, ''))).toEqual(
        expect.objectContaining({ event: 'invite_register', inviterId: 'inviter', inviteeId: 'invitee' }),
      );
    });

    it('日上限已满（UPDATE 无行 + INSERT 冲突）→ 不发会员奖励，欢迎礼照发', async () => {
      const { service, userRepo, usageRepo } = makeService();
      userRepo.findOne.mockResolvedValueOnce({
        id: 'inviter', inviteCode: 'ABCD2345', vipExpireTime: new Date('2026-11-01'),
      });
      usageRepo.query
        .mockResolvedValueOnce([])   // UPDATE 无行
        .mockResolvedValueOnce([]);  // INSERT ON CONFLICT DO NOTHING 无返回
      const result = await service.applyInviteRewards('invitee', 'ABCD2345');
      expect(result).toEqual({ inviterRewarded: false, welcomeGranted: true });
      expect(userRepo.save).not.toHaveBeenCalled();
    });

    it('自邀请（邀请人=被邀请人）→ 直接跳过，不触 usage', async () => {
      const { service, userRepo, usageRepo } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'invitee', inviteCode: 'ABCD2345' });
      const result = await service.applyInviteRewards('invitee', 'ABCD2345');
      expect(result).toEqual({ inviterRewarded: false, welcomeGranted: false });
      expect(usageRepo.query).not.toHaveBeenCalled();
    });

    it('usage 异常 → 吞错返回全 false（奖励旁路，绝不影响注册）', async () => {
      const { service, userRepo, usageRepo } = makeService();
      userRepo.findOne.mockResolvedValueOnce({ id: 'inviter', inviteCode: 'ABCD2345' });
      usageRepo.query.mockRejectedValue(new Error('db down'));
      const result = await service.applyInviteRewards('invitee', 'ABCD2345');
      expect(result).toEqual({ inviterRewarded: false, welcomeGranted: false });
    });

    it('getInviteHome：存量用户懒生成邀请码并统计邀请人数', async () => {
      const { service, userRepo } = makeService();
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'u1', inviteCode: null }) // 本人
        .mockResolvedValueOnce(null); // 候选码无冲突
      userRepo.count.mockResolvedValue(3);
      const home = await service.getInviteHome('u1');
      expect(home.inviteCode).toMatch(/^[A-HJ-NP-Z2-9]{8}$/);
      expect(home.invitedCount).toBe(3);
      // 懒生成后回写
      expect(userRepo.save).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'u1', inviteCode: home.inviteCode }),
      );
    });

    it('getInviteHome：已有码直接返回，不再生成', async () => {
      const { service, userRepo } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'u1', inviteCode: 'ABCD2345' });
      userRepo.count.mockResolvedValue(0);
      const home = await service.getInviteHome('u1');
      expect(home.inviteCode).toBe('ABCD2345');
      expect(userRepo.save).not.toHaveBeenCalled();
      // 里程碑进度：未达档 → claimed=false
      expect(home.milestones?.every((m) => !m.claimed)).toBe(true);
    });

    it('getInviteHome：跨过里程碑档位且已领取 → claimed=true', async () => {
      const { service, userRepo, milestoneRepo } = makeService();
      userRepo.findOne.mockResolvedValue({ id: 'u1', inviteCode: 'ABCD2345' });
      userRepo.count.mockResolvedValue(3);
      milestoneRepo.findOne
        .mockResolvedValueOnce({ userId: 'u1', milestone: 3 }) // 3 人档已领取
        .mockResolvedValueOnce(null); // 10 人档未领取（防御性查询）
      const home = await service.getInviteHome('u1');
      expect(home.milestones?.[0]).toMatchObject({ count: 3, claimed: true });
      expect(home.milestones?.[1]).toMatchObject({ count: 10, claimed: false });
    });
  });

  describe('阶梯邀请里程碑（留存与裂变加强批次）', () => {
    function makeMilestoneService() {
      const ctx = makeService();
      // 默认：日上限 UPDATE 命中 + 欢迎礼成功
      ctx.usageRepo.query
        .mockResolvedValueOnce([{ invite_reward_count: 1 }])
        .mockResolvedValueOnce([]);
      return ctx;
    }

    it('累计邀请跨过 3 人档 → 自动加送 3 天会员（10 人档未达不尝试）', async () => {
      const { service, userRepo, usageRepo, milestoneRepo } = makeMilestoneService();
      // 常驻 mock：applyInviteRewards 与 grantVipDays 内部各查一次邀请人
      userRepo.findOne.mockResolvedValue({ id: 'inviter', inviteCode: 'ABCD2345' });
      userRepo.count.mockResolvedValue(3); // 累计邀请 3 人
      milestoneRepo.query.mockResolvedValue([{ milestone: 3 }]); // 3 人档抢占成功
      const spy = jest.spyOn(customLogger, 'log');

      await service.applyInviteRewards('invitee', 'ABCD2345');

      // 仅 3 人档触发 INSERT；10 人档因未达标被守卫跳过
      expect(milestoneRepo.query).toHaveBeenCalledTimes(1);
      expect(milestoneRepo.query.mock.calls[0][1]).toEqual(['inviter', 3, 3]);
      // 会员发放走 grantVipDays → 事件 invite_milestone
      const milestoneMsg = spy.mock.calls
        .map((c) => String(c[0]))
        .find((m) => m.includes('"invite_milestone"'));
      expect(milestoneMsg).toBeDefined();
    });

    it('里程碑已领取过（INSERT 冲突无返回行）→ 不重复发放', async () => {
      const { service, userRepo, usageRepo, milestoneRepo } = makeMilestoneService();
      userRepo.findOne.mockResolvedValue({ id: 'inviter', inviteCode: 'ABCD2345' });
      userRepo.count.mockResolvedValue(3);
      milestoneRepo.query.mockResolvedValue([]); // ON CONFLICT DO NOTHING 无返回
      const spy = jest.spyOn(customLogger, 'log');

      await service.applyInviteRewards('invitee', 'ABCD2345');

      const milestoneMsgs = spy.mock.calls
        .map((c) => String(c[0]))
        .filter((m) => m.includes('"invite_milestone"'));
      expect(milestoneMsgs).toHaveLength(0);
    });

    it('未达任何档位（累计 1 人）→ 不触碰里程碑表', async () => {
      const { service, userRepo, usageRepo, milestoneRepo } = makeMilestoneService();
      userRepo.findOne
        .mockResolvedValueOnce({ id: 'inviter', inviteCode: 'ABCD2345' })
        .mockResolvedValue(null);
      userRepo.count.mockResolvedValue(1);

      await service.applyInviteRewards('invitee', 'ABCD2345');

      expect(milestoneRepo.query).not.toHaveBeenCalled();
    });
  });

  describe('getAdminOverview（营收看板，商业化闭环批次）', () => {
    /** 带 queryBuilder 的仓库桩（看板全部走 query builder 聚合） */
    function makeQbRepo(opts: {
      rawOne?: Record<string, string>;
      rawMany?: Array<{ uid: string }>;
      count?: number;
      rows?: unknown[];
    }) {
      const qb = {
        select: jest.fn().mockReturnThis(),
        addSelect: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        groupBy: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        getRawOne: jest.fn(async () => opts.rawOne ?? { count: '0', gmv: '0' }),
        getRawMany: jest.fn(async () => opts.rawMany ?? []),
        getCount: jest.fn(async () => opts.count ?? 0),
      };
      return {
        ...makeRepo(),
        createQueryBuilder: jest.fn(() => qb),
        find: jest.fn(async () => opts.rows ?? []),
      };
    }

    it('聚合三窗口 GMV/订单数、付费用户去重、在期会员数与最近订单', async () => {
      const orderRepo = makeQbRepo({
        rawOne: { count: '2', gmv: '380' },
        rawMany: [{ uid: 'u1' }, { uid: 'u2' }],
        rows: [{ id: 'o1', kind: 'unlock', userId: 'u1', amount: 190, status: 'paid', channel: 'xunhupay', update_time: new Date('2026-10-26T10:00:00Z') }],
      });
      const vipOrderRepo = makeQbRepo({
        rawOne: { count: '1', gmv: '990' },
        rawMany: [{ uid: 'u2' }],
        rows: [{ id: 'v1', kind: 'vip', userId: 'u2', amount: 990, status: 'paid', channel: 'mock', update_time: new Date('2026-10-26T11:00:00Z') }],
      });
      const projectRepo = makeRepo();
      const userRepo = makeQbRepo({ count: 1 });
      const usageRepo = makeRepo();
      const milestoneRepo = makeRepo();
      const adapter = makeAdapter();
      const service = new BillingService(
        orderRepo as never, vipOrderRepo as never, projectRepo as never, userRepo as never, usageRepo as never, milestoneRepo as never, adapter as never,
      );

      const overview = await service.getAdminOverview();
      expect(overview.windows.today).toEqual({
        unlockOrders: 2, unlockGmvFen: 380, vipOrders: 1, vipGmvFen: 990,
      });
      // 付费用户并集去重：u1、u2 → 2
      expect(overview.paidUsers).toBe(2);
      expect(overview.vipActiveUsers).toBe(1);
      // 邀请裂变：invitedUsers 由 userRepo qb getCount 返回（与在期会员共用桩值 1）
      expect(overview.invitedUsers).toBe(1);
      // 最近订单按 update_time 倒序：会员单在前
      expect(overview.recentOrders[0]).toMatchObject({ orderId: 'v1', kind: 'vip' });
      expect(overview.recentOrders).toHaveLength(2);
      // 日趋势：固定 14 天窗口（缺日补 0），原始行 gmv 为非法值时按 0 容错
      expect(overview.dailyTrend).toHaveLength(14);
      expect(overview.dailyTrend[0]).toEqual({ day: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), unlockGmvFen: 0, vipGmvFen: 0 });
    });
  });

  describe('buildDailyTrend（日趋势纯函数，付费转化增强批次）', () => {
    it('补齐缺日为 0，双订单类型分列，最新一天在末尾', () => {
      const now = new Date('2026-10-27T12:00:00');
      const trend = buildDailyTrend(
        [{ day: '2026-10-27', gmv: '380' }],
        [{ day: '2026-10-25', gmv: '990' }],
        14,
        now,
      );
      expect(trend).toHaveLength(14);
      expect(trend[13]).toEqual({ day: '2026-10-27', unlockGmvFen: 380, vipGmvFen: 0 });
      expect(trend[11]).toEqual({ day: '2026-10-25', unlockGmvFen: 0, vipGmvFen: 990 });
      expect(trend[0]).toEqual({ day: '2026-10-14', unlockGmvFen: 0, vipGmvFen: 0 });
    });

    it('字符串/非法金额与缺行容错（PG raw 返回字符串，脏数据按 0）', () => {
      const now = new Date('2026-10-27T12:00:00');
      const trend = buildDailyTrend(
        [{ day: '2026-10-27', gmv: 'abc' }],
        [],
        1,
        now,
      );
      expect(trend).toEqual([{ day: '2026-10-27', unlockGmvFen: 0, vipGmvFen: 0 }]);
    });
  });
});
