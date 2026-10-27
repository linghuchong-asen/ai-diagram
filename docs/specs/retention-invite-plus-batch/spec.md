# 留存与裂变加强批次（retention-invite-plus-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P0（留存/营销）
> 前置：邀请裂变批次已收口。领导指令：持续做产品功能点与推广营销。

## Why

1. **缺留存钩子**：用户「注册 → 用完当日 3 次 → 流失」是当前漏斗的最大暗沟。签到是最低成本的日活钩子，且能把留存与会员体系接通（连签 7 天送会员天数，让免费用户体验会员权益后再决策付费）。
2. **邀请激励太线性**：当前每邀请 1 人 +1 天（日上限 3），缺少「值得晒」的阶段性目标。阶梯里程碑（累计 3 人 / 10 人额外加送）给用户一个可规划的冲榜目标，运营话术从「邀请有奖」升级为「邀请冲榜」。

## What Changes

### ADDED-1 每日签到（后端）

- 新表 `daily_checkin`（userId + day 唯一，streak 连续天数）。
- `POST /ai/checkin`（JWT）：当日首次签到 → 连续天数 = 昨日有签则昨日 streak+1，否则 1；当日生成额度 +1（`bonus_generate`，与分享/邀请同池 LEAST 3 封顶）；**连续满 7 天的整数倍 → 会员 +1 天**（`checkin_vip` 增长事件）。当日重复签到幂等返回。
- `GET /ai/checkin`（JWT）：`{checkedToday, streak}` 供前端渲染。
- 新端点挂 AiModule（`CheckinController/CheckinService`，新目录 `ai/checkin/`）。

### ADDED-2 阶梯邀请里程碑（后端）

- 里程碑常量（`billing/invite.ts`）：累计邀请 3 人 → 会员 +3 天；累计 10 人 → 会员 +7 天（一次性，可扩展）。
- 新表 `invite_milestone`（userId + milestone 唯一）：`applyInviteRewards` 内自动发放——被邀请人数跨过阈值且未领取过 → `INSERT ON CONFLICT DO NOTHING` 抢占 → `grantVipDays` 发放（`invite_milestone` 增长事件）。
- `GET /billing/invite/me` 响应新增 `milestones: [{count, days, claimed}]`（进度展示数据源）。
- BillingService 新增公开方法 `grantVipDays(userId, days, event)`：运营侧会员天数发放统一入口（顺延口径复用 nextVipExpire）。

### MODIFIED-1 前端签到与里程碑展示

- AI 浮窗配额栏：已登录用户显示「签到 +1」按钮（当日已签显示「已连签 N 天」），签到成功即时刷新额度文案；连签触发会员奖励时弹提示。
- `/invite` 页：里程碑进度条（3 人 +3 天 / 10 人 +7 天，已领取打勾）+ 规则文案同步。

## 非目标

- 签到日历弹窗、补签卡、连续签到排行榜（数据量大或交互重，后续按数据决定）。
- 邀请排行榜（同上）。

## Impact

- 后端：ai/checkin/（新增）、billing/（invite.ts 常量 + entities + service 里程碑/grantVipDays + module 注册）、ai.module（注册 checkin）。
- 前端：pages/ai/ai_float_window、pages/invite、preView/monetize（里程碑展示纯函数，可选）。
- 数据库（生产手工 DDL）：新表 `daily_checkin`、`invite_milestone`。
- 增长文档：新增「留存引擎：每日签到」节 + §5.5 里程碑规则更新。
