# 投稿激励批次 验收清单（checklist.md）

> 实测日期：2026-10-27。

## 功能验收

- [x] 复制里程碑：被复制 5 次 → 投稿人 +1 天会员；20 次 → +3 天（常量 `COMMUNITY_COPY_MILESTONES` 调档）；跨档自动发放（复制计数 UPDATE RETURNING 原子读回）—— projectShare.service.spec 四用例。
- [x] 防重复：`template_copy_reward` (userId,milestone) 唯一 + INSERT ON CONFLICT DO NOTHING 抢占；已领取不重复发；未达档不触碰领取表。
- [x] 旁路语义：发放抛错 → 复制主链路不受影响；fire-and-forget 微任务链不阻塞 duplicateShare 响应。
- [x] 会员天数统一入口 `grantVipDays`（事件 `community_copy_milestone`）。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：43 套件 / 481 用例全绿（净增 4）。
- [x] 本批无前端改动；tsc 0 错误。

## 文档验收

- [x] changelog 追加；deployment 手册 DDL ⑩（template_copy_reward 建表）；spec/checklist 收口；记忆更新。
