# 会员到期横幅批次（vip-expiry-banner-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27
> 前置：会员到期提醒批次。目标：续费双触点闭环 —— 浮窗 chip 覆盖「用的时候」，首页横幅覆盖「回访第一眼」，并新增「已到期唤醒」场景。

## What Changes

### MODIFIED-1 后端：会员态补过期唤醒口径
- `VipStatusView` 新增 `expiredDays`（已过期整天数 floor ≥1；在期/从未开通 null）。
- `vipExpireTime` 语义调整：从未开通为 null；**历史会员已过期也回传**（供前端计算唤醒文案）。

### ADDED-1 前端：首页到期横幅（共享组件）
- `pages/shared/VipExpiryBanner.tsx` 挂已登录首页（试用草稿条上方，旁路拉取 /billing/vip/status，失败静默隐藏）。
- 展示条件：在期且剩 1 天 →「会员明天到期 · 立即续费」；已过期 ≤7 天 →「会员已到期 N 天，额度已回落至每日 3 次 · 恢复会员权益」（流失超 7 天不打扰）；其余不渲染。
- 按钮 → /pricing 续费动线。

## Impact
- 后端：billing.service（getVipStatus 口径）。
- 前端：pages/shared/VipExpiryBanner（新增）、pages/home/index（挂载）、preView/billing（契约）。
- 无数据库变更。

## 测试与验收
- billing.spec getVipStatus 重写为三态（在期 daysLeft/expiredDays null；近期过期 expiredDays=3 + 时间回传；未开通全 null）。
- 全量 jest 43 套件/481 用例绿；前端 check 0 失败；tsc×2 干净。
