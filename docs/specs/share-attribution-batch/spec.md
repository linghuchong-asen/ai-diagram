# 分享归因批次（share-attribution-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P1（增长/漏斗）
> 前置：邀请归因已有（ic=），但「看了谁的分享链接后来注册」仍是盲区 —— growth 一页纸 §9.2 记录「无 share→register 归因」。本批补上。

## Why

分享裂变（获客引擎 B）的转化率无法归因到具体分享链接：知道总注册数，不知道哪条分享带来注册。渠道投放和话术优化都需要「单链接归因」。

## What Changes

- 分享页落地成功 → `localStorage` 记录 `yutu_share_token`（channel.ts 新增 markShareSource/readShareSource，32 位 hex 白名单清洗）。
- 注册请求新增可选 `shareToken`（DTO 白名单 `^[0-9a-f]{32}$`，非法静默忽略——与邀请码同防御语义）。
- `register` 增长事件携带 `shareToken` → 「token X 的分享页浏览 → 该 token 归因注册」漏斗闭合（share_view 已带 token，两事件按 token join）。
- 邀请归因（ic=）与分享归因（shareToken）互相独立、可并存。

## 非目标

- 注册后自动复制分享者的图（产品行为变化，另评估）；归因看板可视化（先用日志 grep 取数）。

## Impact

- 后端：user/dto、user.service（埋点字段）。
- 前端：utils/channel、main.tsx（无改动——标记在分享页发生）、pages/share、pages/login/register。
- 测试：user.service.spec 一用例 + monetize.check 清洗函数用例。
