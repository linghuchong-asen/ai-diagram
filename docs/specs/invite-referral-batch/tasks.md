# 邀请裂变批次 任务清单（tasks.md）

## R1 规格文档
- [x] spec.md / tasks.md / checklist.md 建档。

## R2 后端
- [x] user 实体：inviteCode（唯一索引）+ invitedBy；@BeforeInsert 生成 8 位码。
- [x] ai_daily_usage 实体：inviteRewardCount。
- [x] CreateUserDto + inviteCode（可选，正则白名单）。
- [x] user.service.register：归因落库（invitedBy）+ 触发奖励（旁路容错）。
- [x] billing.service：applyInviteRewards（邀请人 +1 天/日上限 3、被邀请人 +2 次、自邀请拒、invite_register 事件）、getInviteHome（懒生成 + 战果统计）。
- [x] billing.controller：GET /billing/invite/me；UserModule imports BillingModule。

## R3 前端
- [x] channel.ts：captureInviteCodeOnce（?ic=）+ readInviteCode。
- [x] main.tsx：入口调用邀请码捕获。
- [x] register.tsx：邀请码输入框（自动回填）+ 提交携带。
- [x] pages/invite：活动页（专属链接/复制/规则/战果）+ 路由（PrivateRoute）。

## R4 入口与看板
- [x] 首页 TopLinks「邀请有礼」、价格页底部入口。
- [x] 看板：invitedUsers 统计 + 卡片展示。

## R5 测试
- [x] user.service.spec：邀请码有效归因/非法忽略/奖励旁路失败不影响注册。
- [x] billing.service.spec：奖励 +1 天、日上限 3、自邀请拒、欢迎 +2、懒生成唯一码。
- [x] monetize.check：buildInviteLink / sanitizeInviteCode。

## R6 全量回归
- [x] 后端全量 jest 绿；前端全部 check 绿；前后端 tsc 0 错误。

## R7 文档收尾
- [x] growth 一页纸新增「获客引擎 D：邀请裂变」（话术/渠道/口径）。
- [x] changelog、deployment DDL、checklist 勾结、记忆更新。
