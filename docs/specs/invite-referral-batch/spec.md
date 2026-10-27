# 邀请裂变批次（invite-referral-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P0（增长/营销）
> 领导指令：不止修 bug，重点做产品功能点与推广营销。本批给增长一页纸的获客引擎补上「用户自驱拉新」的动机层。

## Why（头脑风暴结论）

现有三个获客引擎（免登录试用 / 分享裂变 / 模板长尾）的传播者都是「无私奉献」——用户把链接发到群里，收益全归产品。增长一页纸的渠道打法（校园群/贴吧/小红书）全都依赖「发链接」，但用户没有自驱动机。**把「发链接」升级成「发我的邀请链接」**：邀请好友注册，邀请人直接得会员天数——会员既是奖励又是变现权益，裂变与商业化互相放大；被邀请的新用户得欢迎额度，降低首日流失。合规红线自查：属「自愿激励」，不做「不转发不能解锁」类强制话术；防刷依赖既有注册限流 + 单日奖励上限。

## What Changes（ADDED / MODIFIED）

### ADDED-1 邀请码体系（后端）

- `user` 表新增 `invite_code varchar(16)`（唯一索引，8 位无歧义字符集，去除 0/O/1/I；新用户 `@BeforeInsert` 自动生成，存量用户首次访问邀请页懒生成）与 `invited_by varchar(16)`（归因：记录邀请人的码）。
- `ai_daily_usage` 表新增 `invite_reward_count int default 0`（邀请奖励当日计数，与配额同表同键，LEAST 3 封顶防刷）。
- 注册 DTO 新增可选 `inviteCode`（`^[A-Za-z0-9]{4,16}$`，非法/不存在一律忽略，注册永不因邀请码失败）。
- 注册成功且邀请码有效 → 被邀请人落 `invited_by` + **双向奖励**（奖励是旁路，失败不影响注册主链路）：
  - 邀请人：会员有效期 +1 天（未开通 = 从当天起 +1 天，即 1 天体验会员；在期 = 现有到期时间顺延），**单日上限 +3 天**（`invite_reward_count` 封顶）；不与被邀请人是否付费挂钩；
  - 被邀请人：当日生成额度 +2（欢迎礼，写 `bonus_generate`，与既有分享奖励同口径叠加）。
  - 记 `invite_register` 增长事件（inviterId/inviteeId）。
- 新端点 `GET /billing/invite/me`（JWT）：`{inviteCode, invitedCount, vip, vipExpireTime}`——懒生成存量用户邀请码。

### ADDED-2 邀请活动页 `/invite`（前端，登录态）

- 专属邀请链接展示与一键复制（`${origin}/register?ic=<码>`）、活动规则（说准确：+1 天/人、日上限 +3 天、好友得 +2 次）、我的战果（已邀请 N 人 / 会员到期日）。
- 未登录经 PrivateRoute 跳登录带 redirect 回流。

### ADDED-3 邀请码入口捕获（前端）

- 应用入口捕获 `?ic=` 参数存 localStorage（沿用 `?ch=` 渠道捕获机制，独立 key）。
- 注册页新增「邀请码（选填）」输入框，自动用已捕获的码回填；提交随请求带上。

### MODIFIED-1 入口与看板

- 入口：首页 TopLinks「邀请有礼」、价格页底部「邀请好友，双方都得」。
- 营收看板新增「累计邀请注册」卡片（`invited_by IS NOT NULL` 用户数）——裂变效果可视化。

## 非目标

- 邀请排行榜、阶梯奖励（邀请 5 人得月卡）、被邀请人付费分成（返佣合规风险高，另批评估）。
- 签到打卡（留存向，另批）。

## Impact

- 后端：user/（entity/dto/service/module）、billing/（service 加邀请逻辑 + controller 端点 + module 注册 usage 仓库）、observability 不动。
- 前端：utils/channel、main.tsx、pages/login/register、pages/invite（新增）、pages/home/landing、pages/pricing、pages/admin/revenue、monetize.ts（邀请链接纯函数）。
- 数据库（生产手工 DDL 见 deployment 手册）：user 加两列 + 唯一索引；ai_daily_usage 加一列。
- 增长文档：新增「获客引擎 D：邀请裂变」执行方案。
