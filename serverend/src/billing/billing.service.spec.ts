// 语图 Task 6：按次付费解锁服务单测（纯逻辑直测，mock 仓库/适配器，不起 Nest TestingModule）
import { HttpStatus } from '@nestjs/common';
import { BillingService } from './billing.service';
import { xunhupaySign } from './adapters/xunhupay.adapter';
import { customLogger } from '../utils/log/logger.service';
import type { UnlockOrderEntity } from './entities/unlock_order.entity';

/** 仓库桩：service 只用 findOne / save / delete / create 四个方法 */
function makeRepo() {
  return {
    findOne: jest.fn(),
    save: jest.fn(),
    delete: jest.fn(),
    create: jest.fn((x: Partial<UnlockOrderEntity>) => x),
  };
}

/** 适配器桩：createPayment 返回 null 模拟未配置，返回 { payUrl } 模拟已配置 */
function makeAdapter() {
  return { createPayment: jest.fn() };
}

function makeService() {
  const orderRepo = makeRepo();
  const projectRepo = makeRepo();
  const adapter = makeAdapter();
  const service = new BillingService(
    orderRepo as never,
    projectRepo as never,
    adapter as never,
  );
  return { service, orderRepo, projectRepo, adapter };
}

/** 本套件涉及的 env 键（读写后还原，避免用例间串扰） */
const ENV_KEYS = ['UNLOCK_PRICE_FEN', 'XUNHU_APP_SECRET'] as const;
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

    it('通道未配置（adapter 返回 null）→ mode:sponsor，不报错', async () => {
      const { service, projectRepo, adapter } = makeService();
      projectRepo.findOne.mockResolvedValue({ id: '1', userId: 'u1', unlocked: false });
      adapter.createPayment.mockResolvedValue(null);
      await expect(service.createUnlockOrder('u1', '1')).resolves.toEqual({
        orderId: expect.any(String),
        mode: 'sponsor',
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
});
