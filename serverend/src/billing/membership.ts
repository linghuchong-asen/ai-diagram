// 语图商业化闭环批次 - 会员态判定纯函数
// 供 billing（回调放行/状态查询）、quota（会员额度）、projectManager/projectShare
// （全站免水印判定）多处复用。只做纯计算、零依赖，方便各模块直接 import 不产生 DI 耦合。

/** 会员时长（天/单）：续费在现有未过期时间上叠加（与 billing.service 回调放行同口径） */
export const VIP_MONTH_DAYS = 30;

/** 判断会员是否在期（null/undefined/过去时间都视为未开通） */
export function isVipActive(
  vipExpireTime: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (vipExpireTime == null) return false;
  return new Date(vipExpireTime).getTime() > now.getTime();
}
