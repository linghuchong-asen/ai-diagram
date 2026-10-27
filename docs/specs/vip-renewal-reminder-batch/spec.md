# 会员到期提醒批次（vip-renewal-reminder-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P1（商业化/留存）
> 前置：留存与裂变加强批次收口。连签/邀请都会送会员体验天数——体验期结束的「额度落差」（30 次/日 → 3 次/日）就是天然付费窗口，本批把提醒做出来。

## Why

会员（含签到/邀请赠送的体验会员）到期后额度从 30 次/日回落到 3 次/日，但产品没有任何到期提示——用户只会在 429 被拦时感到困惑。到期前 3 天是续费说服的黄金窗口。

## What Changes

### MODIFIED-1 后端：会员态带剩余天数（单一口径）

- `VipStatusView` 新增 `daysLeft: number | null`（在期剩余整天数，ceil；非在期为 null）——续费提醒的服务端唯一口径。

### MODIFIED-2 前端：浮窗到期提醒 + 续费动线

- 浮窗配额栏：会员在期时显示剩余天数 chip；**剩 ≤3 天 → 警示样式「N 天后到期 · 续费」，点击直达 /pricing**（未到期常态显示「会员剩 N 天」）。
- 纯函数 `vipDaysLeft` / `vipRenewalText`（monetize.ts，阈值常量 3 天）供 check 直测。

### MODIFIED-3 前端：价格页续费信息

- 会员卡在期时显示「剩 N 天，续费自动顺延 30 天，不丢剩余天数」。

## 非目标

- 到期邮件/短信通知（无邮件服务依赖，后续评估）；到期当日全屏拦截（打扰度过高）。

## Impact

- 后端：billing.service（getVipStatus）。
- 前端：pages/ai/ai_float_window、pages/pricing、monetize.ts。
- 测试：billing spec（daysLeft 三态）+ monetize.check（纯函数）。
