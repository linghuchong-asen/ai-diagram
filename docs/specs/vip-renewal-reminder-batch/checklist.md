# 会员到期提醒批次 验收清单（checklist.md）

> 实测日期：2026-10-27。

## 功能验收

- [x] 服务端续费口径：`GET /billing/vip/status` 新增 `daysLeft`（在期 ceil ≥1 天；非在期 null）—— billing.spec 三态断言。
- [x] 浮窗提醒：会员在期显示剩余天数 chip；**剩 ≤3 天警示样式「N 天后到期 · 续费」点击直达 /pricing**；试用态/非会员不渲染。
- [x] 价格页：在期会员卡显示「剩 N 天（续费自动顺延 30 天，不丢剩余天数）」。
- [x] 纯函数 `vipDaysLeft`/`vipRenewalText`（阈值常量 3 天）—— monetize.check 三用例（ceil 语义/空值容错/窗口文案）。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：43 套件 / 471 用例全绿。
- [x] 前端全部 check 脚本 0 失败（monetize.check 21 → 24）；前后端 tsc 0 错误。

## 文档验收

- [x] spec/checklist 收口；changelog 追加；记忆更新。
