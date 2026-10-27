// 语图商业化闭环批次 - 模拟支付适配器（沙箱演示通道）
// 用途：真实支付商户（虎皮椒）开通前，把「下单 → 支付 → 回调 → 权益生效」
// 全链路端到端跑通、可演示、可测试 —— 让盈利方式「看得见」。
// 安全红线（三重闸门，缺一不可）：
//   1) env PAY_CHANNEL 显式等于 'mock' 才启用（默认 xunhupay，生产不可达）；
//   2) env MOCK_PAY_SECRET 必须已配置（未配置视为通道未配置，回落赞助模式）；
//   3) 模拟回调 POST /billing/notify/mock 必须携带 HMAC-MD5(orderId, MOCK_PAY_SECRET)
//      签名，签名由服务端拼进 payUrl，伪造请求过不了验签。
// 任何人若在生产误配 PAY_CHANNEL=mock，等于任何人可免费解锁 —— 部署文档已明令禁止。
import { createHmac } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { PaymentAdapter, PaymentOrderInfo } from './payment-adapter';

/** mock 通道是否启用：PAY_CHANNEL=mock 且 MOCK_PAY_SECRET 已配置（双闸门） */
export function mockPayEnabled(): boolean {
  return (
    String(process.env.PAY_CHANNEL ?? '').toLowerCase() === 'mock' &&
    Boolean(process.env.MOCK_PAY_SECRET)
  );
}

/** 计算模拟支付回调签名：HMAC-MD5(orderId, secret)，与回调验签共用同一算法 */
export function mockPaySign(orderId: string, secret: string): string {
  return createHmac('md5', secret).update(orderId).digest('hex');
}

@Injectable()
export class MockPayAdapter implements PaymentAdapter {
  /** 通道名（落库 order.channel 用于对账；mock 单在对账时一目了然是沙箱单） */
  readonly name = 'mock';

  /** 通道是否已配置：见模块头注释三重闸门的前两道 */
  isConfigured(): boolean {
    return mockPayEnabled();
  }

  /**
   * 生成站内模拟收银台地址：/mock-pay?orderId=..&sign=..&kind=..&projectId=..。
   * sign 随 payUrl 下发，模拟支付页将其原样 POST 回 /billing/notify/mock 完成放行；
   * 第三方无法伪造 sign（HMAC 依赖服务端 secret），也无法用它支付别的订单。
   */
  async createPayment(
    order: PaymentOrderInfo,
  ): Promise<{ payUrl: string } | null> {
    if (!this.isConfigured()) return null;

    const baseUrl = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
    const callbackBase = order.origin
      ? order.origin.replace(/\/+$/, '')
      : baseUrl;
    const secret = process.env.MOCK_PAY_SECRET as string;
    const params = new URLSearchParams({
      orderId: order.id,
      sign: mockPaySign(order.id, secret),
    });
    if (order.kind) params.set('kind', order.kind);
    if (order.projectId) params.set('projectId', String(order.projectId));
    return { payUrl: `${callbackBase}/mock-pay?${params.toString()}` };
  }
}
