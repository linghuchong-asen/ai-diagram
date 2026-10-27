// 语图 Task 6 - 支付通道适配器接口
// 通道无关抽象：billing.service 只依赖本接口语义，不感知具体网关字段。
// 返回 null 表示通道未配置（未填 appid/secret），此时走赞助引导模式，不报错。

/** 订单类型：unlock = 单项目按次解锁；vip = 会员月卡（商业化闭环批次） */
export type PaymentOrderKind = 'unlock' | 'vip';

/** 传给支付适配器的订单信息（服务端定价后的订单） */
export interface PaymentOrderInfo {
  /** 订单号（unlock_order.id / vip_order.id） */
  id: string;
  /** 金额（单位：分） */
  amount: number;
  /** 前端来源页（用于支付完成后的浏览器回跳，可选） */
  origin?: string;
  /** 订单类型（回跳页按类型区分轮询端点与落地页，可选） */
  kind?: PaymentOrderKind;
  /** 项目 id（仅 unlock 单；回跳页跳回 /preview/:projectId 用，可选） */
  projectId?: string;
}

/** 支付适配器：创建支付（返回支付提交地址） */
export interface PaymentAdapter {
  /** 通道名（落库 order.channel 用于对账：xunhupay / mock） */
  readonly name: string;

  /**
   * 组装支付参数并签名。
   * 返回 { payUrl }：通道已配置，前端跳转/提交该地址完成支付；
   * 返回 null：通道未配置（赞助模式，前端展示赞助引导，不报错）。
   */
  createPayment(order: PaymentOrderInfo): Promise<{ payUrl: string } | null>;
}
