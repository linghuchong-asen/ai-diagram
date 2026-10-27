# 留存与裂变加强批次 验收清单（checklist.md）

> 实测日期：2026-10-27。前置：monetization-loop-batch / monetization-conversion-batch / invite-referral-batch 已收口。

## 功能验收

- [x] 每日签到：当日首次签到额度 +1（bonus_generate 同池 LEAST 3）；当日重复签到幂等（唯一约束兜底并发）—— checkin.service.spec 六用例。
- [x] 连签奖励：昨日 streak=6 → 今日 7 → 会员 +1 天（`checkin_vip` 事件）；断签重置 streak=1。
- [x] 阶梯邀请里程碑：累计 3 人 +3 天 / 10 人 +7 天，跨档自动发放、每档一次（INSERT ON CONFLICT DO NOTHING 抢占防并发重复）；**未达档位有守卫不尝试**（实现期自查修掉一处漏守卫的缺陷）—— billing.service.spec 三用例。
- [x] 会员天数发放统一入口 `grantVipDays`（签到/里程碑共用，顺延口径复用 nextVipExpire + 增长事件留痕）。
- [x] `/ai/checkin` GET/POST 端点（JWT）；`/billing/invite/me` 返回里程碑进度。
- [x] 前端：浮窗配额栏「签到 +1 / 已连签 N 天」按钮（签到成功即时刷新额度、会员奖励弹窗）；`/invite` 页里程碑进度条 + 规则文案同步。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：**43 套件 / 466 用例全绿**（净增 10：签到 6 + 里程碑 3 + getInviteHome 进度 1）。
- [x] 前端全部 check 脚本 0 失败；前端 tsc 0 错误；后端 tsc 0 错误。

## 文档验收

- [x] growth 一页纸新增「§5.6 留存引擎：每日签到」+ §5.5 里程碑规则更新。
- [x] changelog 追加本批章节。
- [x] deployment 手册手工 DDL ⑦（daily_checkin / invite_milestone 两表）。
- [x] tasks.md 勾结、spec.md 状态、记忆更新。
