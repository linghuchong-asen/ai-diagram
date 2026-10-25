/*
 * @Description: 按次付费解锁接口（Task 6.3 预览页解锁动线）
 *   POST /billing/unlock/:projectId  创建解锁订单（登录态，金额服务端定价）
 *   GET  /billing/order/:orderId     查询本人订单（支付结果轮询用）
 * 支付模式语义（后端契约）：
 *   mode:'pay'    → 返回 payUrl（含签名参数的网关提交地址，window.open 跳转）
 *   mode:'sponsor'→ 收款通道未配置，产品表现为赞助引导（不报错不阻断）
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
