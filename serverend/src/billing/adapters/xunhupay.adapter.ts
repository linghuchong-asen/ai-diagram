// 语图 Task 6 - 虎皮椒（xunhupay）支付适配器
// 签名与字段以官方文档 https://www.xunhupay.com/doc 为准，接入时需人工比对。
// 配置：env XUNHU_APP_ID 与 XUNHU_APP_SECRET 两者齐才算已配置，
//       缺任一则 createPayment 返回 null（走赞助模式，不报错）。
import { createHash, randomBytes } from 'crypto';
import { Injectable } from '@nestjs/common';
import type { PaymentAdapter, PaymentOrderInfo } from './payment-adapter';

/** 虎皮椒统一网关支付提交地址（POST 表单）。地址以官方文档为准，接入时需人工比对。 */
const XUNHU_PAY_GATEWAY_URL = 'https://api.xunhupay.com/payment/do.html';

/**
 * 虎皮椒 MD5 签名（纯函数，下单与回调验签共用同一算法）：
 *   1. 剔除 hash 本身与空值参数（非空参数才参与签名）；
 *   2. 按 key ASCII 升序拼成 k=v& 串（join('&')，无尾随 &）；
 *   3. 末尾直接接 appsecret（无 & 分隔），md5 小写十六进制作为 hash。
 * 具体规则以官方文档为准，接入时需人工比对。
 */
export function xunhupaySign(
  params: Record<string, unknown>,
  appSecret: string,
): string {
  const raw =
    Object.keys(params)
      .filter(
        (key) =>
          key !== 'hash' &&
          params[key] !== undefined &&
          params[key] !== null &&
          `${params[key]}` !== '',
      )
      .sort() // JS 默认按码元排序，对 ASCII 键即 ASCII 升序
      .map((key) => `${key}=${params[key]}`)
      .join('&') + appSecret;
  return createHash('md5').update(raw, 'utf8').digest('hex');
}

@Injectable()
export class XunhupayAdapter implements PaymentAdapter {
  /** 通道是否已配置：XUNHU_APP_ID 与 XUNHU_APP_SECRET 齐全才视为已配置 */
  isConfigured(): boolean {
    return Boolean(process.env.XUNHU_APP_ID && process.env.XUNHU_APP_SECRET);
  }

  /**
   * 组装虎皮椒统一网关支付参数并签名。
   * 注意：虎皮椒网关官方要求以 POST 表单提交至网关地址；此处将全部已签名参数
   * 拼入查询串返回完整 payUrl，前端可直接跳转（或按官方文档改为表单提交）。
   * 字段含义与签名细节以官方文档为准，接入时需人工比对。
   */
  async createPayment(
    order: PaymentOrderInfo,
  ): Promise<{ payUrl: string } | null> {
    if (!this.isConfigured()) return null;

    // 回调域名：env BASE_URL（须公网可达，如 http://8.140.203.51）
    const baseUrl = (process.env.BASE_URL ?? '').replace(/\/+$/, '');
    // 前端回跳页：优先用下单请求的来源页 origin，其次 BASE_URL
    const callbackBase = order.origin
      ? order.origin.replace(/\/+$/, '')
      : baseUrl;

    const params: Record<string, string> = {
      appid: process.env.XUNHU_APP_ID as string,
      trade_order_id: order.id, // 订单号 = unlock_order.id
      total_fee: (order.amount / 100).toFixed(2), // 分转元，两位小数字符串
      title: '语图-流程图解锁',
      time: String(Math.floor(Date.now() / 1000)), // 秒级时间戳
      nonce: randomBytes(8).toString('hex'), // 随机串防重放
      type: 'QR', // 扫码支付
      version: '2.0',
      // 服务端异步回调端点（验签 + 放行解锁都在此处理）；经 nginx 对外路径带 /api 前缀
      notify_url: `${baseUrl}/api/billing/notify/xunhupay`,
      // 支付完成后浏览器回跳的前端页面
      callback: `${callbackBase}/unlock-result`,
    };

    const hash = xunhupaySign(params, process.env.XUNHU_APP_SECRET as string);
    const query = Object.keys(params)
      .map((key) => `${key}=${encodeURIComponent(params[key])}`)
      .join('&');
    return { payUrl: `${XUNHU_PAY_GATEWAY_URL}?${query}&hash=${hash}` };
  }
}
