# 分享归因批次 验收清单（checklist.md）

> 实测日期：2026-10-27。

## 功能验收

- [x] 分享页落地成功 → localStorage 记录来源 token（32 位 hex 白名单清洗、首次触达优先、静默容错）—— utils/channel.ts。
- [x] 注册请求随带 shareToken；DTO 白名单 + service 层 `^[0-9a-f]{32}$` 校验，非法静默忽略 —— user.service.spec 两用例。
- [x] `register` 事件携带 shareToken → 与 `share_view`（已带 token）按 token join，「分享浏览 → 注册」漏斗闭合。
- [x] 邀请归因（ic=）与分享归因（shareToken）互相独立、可并存。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：43 套件 / 473 用例全绿（净增 2）。
- [x] 前端全部 check 0 失败；前后端 tsc 0 错误。

## 文档验收

- [x] growth 一页纸 §9.2 更新（浏览→注册归因已闭合）；changelog 追加；spec/checklist 收口；记忆更新。
