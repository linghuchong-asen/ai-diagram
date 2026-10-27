/*
 * @Description: 计费接口（Task 6.3 预览页解锁动线 + 商业化闭环批次会员月卡）
 *   POST /billing/unlock/:projectId  创建解锁订单（登录态，金额服务端定价）
 *   GET  /billing/order/:orderId     查询解锁订单（支付结果轮询用）
 *   POST /billing/vip/order          创建会员月卡订单（登录态，金额服务端定价）
 *   GET  /billing/vip/order/:orderId 查询会员订单（轮询用）
 *   GET  /billing/vip/status         当前会员状态（顶栏会员标识）
 * 支付模式语义（后端契约）：
 *   mode:'pay'    → 返回 payUrl（含签名参数的网关提交地址，window.open 跳转）
 *   mode:'sponsor'→ 收款通道未配置，产品表现为赞助引导（不报错不阻断）
 * 快赢批次一(QW5)：下单结果新增 firstOrder —— 用户首笔解锁按首单价（后端
 *   FIRST_UNLOCK_PRICE_FEN 定价），前端据此展示「首单特惠」标记与锚点文案。
 * 商业化闭环批次：会员月卡同构接口 —— 首张会员单按首月特惠价（后端
 *   VIP_MONTH_FIRST_PRICE_FEN），会员在期去水印/额度权益由后端判定下发。
 */

import { useMutation } from "react-query";
import { http, onErrorTips } from "../../utils/http";

/** 下单结果（后端契约）：pay=跳转支付；sponsor=通道未配置走赞助引导 */
export interface UnlockOrderResult {
  orderId: string | null;
  mode?: "pay" | "sponsor";
  payUrl?: string;
  /** 项目已是解锁态时不重复下单 */
  alreadyUnlocked?: boolean;
  /** 快赢批次一：本次是否按首单优惠价下单（前端展示「首单特惠」标记） */
  firstOrder?: boolean;
}

/** 订单视图（后端契约）：amount 单位分，status 单向 pending → paid */
export interface UnlockOrderView {
  orderId: string;
  projectId: string;
  status: "pending" | "paid";
  amount: number;
  channel: string;
}

/** 创建解锁订单（金额服务端定价，前端不传金额） */
export const useUnlockProject = () => {
  return useMutation(
    (projectId: string) =>
      http<UnlockOrderResult>(`/billing/unlock/${projectId}`, {
        method: "post",
      }),
    { onError: onErrorTips }
  );
};

/** 查询订单（轮询 helper）：供支付结果轮询循环按次调用，不进 react-query 缓存 */
export const getUnlockOrder = async (orderId: string) => {
  const response = await http<UnlockOrderView>(`/billing/order/${orderId}`);
  return response.data;
};

/* ===== 会员月卡（商业化闭环批次） ===== */

/** 会员下单结果（后端契约，语义与解锁下单一致） */
export interface VipOrderResult {
  orderId: string | null;
  mode?: "pay" | "sponsor";
  payUrl?: string;
  /** 是否用户首张会员单（前端展示「首月特惠」标记） */
  firstOrder?: boolean;
}

/** 会员订单视图（后端契约）：amount 单位分，status 单向 pending → paid */
export interface VipOrderView {
  orderId: string;
  sku: string;
  status: "pending" | "paid";
  amount: number;
  channel: string;
}

/** 会员状态（后端契约）：vip = 在期；daysLeft/expiredDays = 提醒与唤醒口径（服务端唯一计算） */
export interface VipStatusView {
  vip: boolean;
  /** ISO 字符串；从未开通为 null（历史会员已过期也回传） */
  vipExpireTime: string | null;
  /** 在期剩余整天数（ceil ≥1；非在期为 null） */
  daysLeft?: number | null;
  /** 已过期整天数（floor ≥1；在期/从未开通为 null） */
  expiredDays?: number | null;
}

/** 创建会员月卡订单（金额服务端定价；在期会员可重复下单续费叠加） */
export const useCreateVipOrder = () => {
  return useMutation(
    () => http<VipOrderResult>("/billing/vip/order", { method: "post" }),
    { onError: onErrorTips }
  );
};

/** 查询会员订单（轮询 helper，回跳页/弹窗共用） */
export const getVipOrder = async (orderId: string) => {
  const response = await http<VipOrderView>(`/billing/vip/order/${orderId}`);
  return response.data;
};

/** 查询当前会员状态（预览页顶栏会员标识用；旁路，失败静默） */
export const getVipStatus = async () => {
  const response = await http<VipStatusView>("/billing/vip/status");
  return response.data;
};
