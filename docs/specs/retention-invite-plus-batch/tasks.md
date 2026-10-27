# 留存与裂变加强批次 任务清单（tasks.md）

## R1 规格文档
- [x] spec.md / tasks.md / checklist.md 建档。

## R2 后端签到
- [x] 实体 daily_checkin（userId+day 唯一，streak）。
- [x] CheckinService：status/checkin（幂等、连续天数、bonus +1 LEAST 3、streak%7==0 → grantVipDays）。
- [x] CheckinController：GET/POST /ai/checkin（JWT）；AiModule 注册。

## R3 后端阶梯邀请
- [x] billing/invite.ts 常量 INVITE_MILESTONES（3 人 +3 天 / 10 人 +7 天）。
- [x] 实体 invite_milestone（userId+milestone 唯一）。
- [x] BillingService.grantVipDays 公开方法；applyInviteRewards 自动发放里程碑；getInviteHome 返回 milestones 进度。

## R4 前端
- [x] 浮窗配额栏签到按钮（状态拉取/签到/成功刷新额度/会员奖励提示）。
- [x] /invite 页里程碑进度 + 规则文案更新。

## R5 测试
- [x] checkin.service.spec：首签/重复幂等/连签续 streak/断签重置/满 7 天送会员。
- [x] billing.service.spec：里程碑跨阈值发放一次/不重复/进度返回。
- [x] 全量回归 + tsc。

## R6 文档收尾
- [x] growth 一页纸「留存引擎：每日签到」+ §5.5 里程碑更新；changelog；deployment DDL；checklist；记忆。
