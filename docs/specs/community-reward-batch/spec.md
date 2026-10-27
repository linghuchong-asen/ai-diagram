# 投稿激励批次（community-reward-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P1（增长/内容供给侧）
> 前置：模板使用统计批次收口（copy_count 数据就绪）。目标：把「投稿」从荣誉激励升级为收益激励——作品被复制跨档自动送会员天数。

## Why

社区模板的供给侧是增长长尾的关键。当前投稿者只有署名曝光，缺少可量化的收益预期。「被复制」是作品价值的最强信号——按复制档位自动发放会员天数，与邀请里程碑同构，供给侧的自驱动机闭合。

## What Changes

- 常量 `COMMUNITY_COPY_MILESTONES`（template/community-rewards.ts）：被复制 5 次 → +1 天；被复制 20 次 → +3 天（改常量即调档）。
- 新表 `template_copy_reward`（userId + milestone 唯一）：领取记录，`INSERT ON CONFLICT DO NOTHING RETURNING` 抢占防并发重复发放。
- `duplicateShare` 复制计数改为 `RETURNING` 原子读回 → 跨档时自动 `grantVipDays(ownerId, days, 'community_copy_milestone')`（复用会员天数统一入口；全程旁路吞错）。
- 查看计数保持 fire-and-forget（view 无奖励语义）。

## 非目标

- 激励进度展示（投稿者侧「我的作品被复制 N 次」面板，另批）；现金分成（合规风险，不做）。

## Impact

- 后端：template/（常量 + 实体）、projectShare/（复制计数改为 RETURNING + 里程碑发放 + module 引 BillingModule）。
- 数据库：新表 `template_copy_reward`（DDL ⑩）。
- 测试：projectShare.service.spec（跨档发放一次/已领取不重复/未达档不触碰）。
