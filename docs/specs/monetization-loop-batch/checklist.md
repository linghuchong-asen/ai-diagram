# 商业化闭环批次 验收清单（checklist.md）

> 全部通过后批次才算收口。证据 = 测试命令输出或代码位置。
> 实测日期：2026-10-26 晚。

## 功能验收

- [x] 会员下单：`POST /billing/vip/order` 首月 590 分 / 常规 990 分（env 可覆盖），金额只信服务端 —— `billing.service.spec.ts` createVipOrder 五用例。
- [x] 会员回调：paid 后 `user.vip_expire_time` 正确叠加（首购 now+30d；在期续费 = 旧到期+30d 不丢剩余天数）；重复回调幂等不改库 —— handleNotify 分发/幂等用例。
- [x] 会员额度：VIP 生成额度 30+bonus，过期回落 3+bonus，`VIP_DAILY_GENERATE_LIMIT` 可覆盖 —— `quota.service.spec.ts` 会员额度五用例。
- [x] 会员免水印：VIP 名下所有项目 `GET /project/:id` 与分享视图 `unlocked=true`（预览/分享/导出全链路无水印）—— projectManager findById / projectShare viewShare 用例。
- [x] 回跳页：`/unlock-result` 路由注册（`frontend/src/router/routes.tsx`），paid 自动跳回预览页/首页 —— `monetize.check.ts` 参数解析用例 + 页面轮询逻辑。
- [x] mock 通道：`PAY_CHANNEL=mock + MOCK_PAY_SECRET` 时端到端可演示（下单 → /mock-pay → 模拟支付 → 权益生效）；缺 secret 或非 mock 时 `/billing/notify/mock` 拒绝一切请求 —— handleMockNotify 四用例。
- [x] 虎皮椒通道不回归：未配置时仍 sponsor 降级；回调验签逻辑不变 —— billing.service.spec 既有用例全绿。
- [x] 分享页：owner 看到解锁直达；访客不泄露归属信息（无 isOwner/projectId 字段）—— project_share.service.spec 可选鉴权五用例。
- [x] 营收看板：root 可见三窗口 GMV/订单/会员数；非 root 403（controller ForbiddenException）—— getAdminOverview 聚合用例。

## 安全验收（红线）

- [x] 金额只信服务端：前端不传金额；回调金额字段不作为放行依据（dispatchPaidOrder 不读金额字段）。
- [x] 归属校验：会员查单非本人 → 404；admin overview 非 root → 403；顺带修复 `/project/:id` 归属校验因 select 缺 userId 形同虚设的存量漏洞。
- [x] mock 通道：生产默认不可达（PAY_CHANNEL 默认 xunhupay；mock 需同时配置 secret）；部署手册明示红线。

## 回归验收（实测 2026-10-26）

- [x] 后端全量 jest：**42 套件 / 445 用例全绿**（基线 40 套件/395 用例 → 净增 50 用例，无回归）。
- [x] 前端全部 check 脚本：**14 个脚本 213 断言全绿**（基线 13 个 + 本批 monetize.check 13 用例）。
- [x] 前端 tsc、后端 tsc 均 0 错误。

## 文档验收

- [x] growth 一页纸更新（§6 会员定价/触点/沙箱/看板口径，§9 待确认 3/4/5/9 项更新）。
- [x] changelog 追加「商业化闭环批次」章节（`docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md`）。
- [x] deployment 手册：手工 DDL ④（user 加列）⑤（vip_order 建表）+ 新 env（VIP_MONTH_PRICE_FEN / VIP_MONTH_FIRST_PRICE_FEN / VIP_DAILY_GENERATE_LIMIT / PAY_CHANNEL / MOCK_PAY_SECRET）+ mock 红线。
- [x] tasks.md 勾结、spec.md 状态置「已实施」。
