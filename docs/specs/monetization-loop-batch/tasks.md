# 商业化闭环批次 任务清单（tasks.md）

> 对应 spec：`monetization-loop-batch/spec.md`。每轮完成即跑对应测试，全绿才进下一轮。

## R1 规格与任务文档
- [x] spec.md / tasks.md / checklist.md 建档。

## R2 后端会员制底座（ADDED-1）
- [x] `user.entity` 新增 `vip_expire_time timestamp NULL`。
- [x] 新实体 `billing/entities/vip_order.entity.ts`（与 unlock_order 同构，sku 固定 vip_month）。
- [x] `billing.service`：`createVipOrder`（定价 `VIP_MONTH_PRICE_FEN` 默认 990、首单判定同口径）、`queryVipOrder`、`getVipStatus`；回调放行抽象 `applyPaid` 供两通道复用；会员到期叠加（未到期 = 到期时间+30d，否则 now+30d）。
- [x] `billing.controller`：`POST /billing/vip/order`、`GET /billing/vip/order/:orderId`、`GET /billing/vip/status`；回调后记 `vip_pay` 增长事件。

## R3 会员权益接入（MODIFIED-1/2）
- [x] `quota.service`：读 user.vipExpireTime，会员额度 `VIP_DAILY_GENERATE_LIMIT`（默认 30）+ bonus；`DailyUsageView` 加 `vip`/`vipExpireTime`。
- [x] `GET /project/:id` 输出 `unlocked = project.unlocked || ownerVip`（projectManager.service）。
- [x] 分享视图输出同样口径（projectShare.service.viewShare）。

## R4 模拟支付通道（ADDED-2）
- [x] `adapters/payment-adapter.ts` 增加 token 注入与工厂（`PAY_CHANNEL=mock|xunhupay`）。
- [x] `adapters/mock-pay.adapter.ts`：HMAC 签名 payUrl + `isConfigured`（mock 需 MOCK_PAY_SECRET）。
- [x] `billing.service.handleMockNotify`（验 HMAC → `applyPaid`）；`billing.controller` 新增 `POST /billing/notify/mock`（@Public + @SkipInterceptor）。
- [x] 两个真实通道 callback URL 带订单上下文（orderId/projectId/kind）。

## R5 前端支付闭环 UI（ADDED-3 + MODIFIED-3）
- [x] `billing.ts` 增会员接口（useCreateVipOrder / getVipOrder / getVipStatus）。
- [x] 预览页解锁弹窗双 SKU 切换 + 会员生效态展示。
- [x] 新页 `pages/unlockResult`：轮询 → 成功跳预览/首页，超时指引。
- [x] 新页 `pages/mockPay`：读 orderId+sign，展示金额，「模拟支付成功」→ POST mock 回调。
- [x] 路由表注册 `/unlock-result`、`/mock-pay`（公开页）。

## R6 分享页变现入口（ADDED-5）
- [x] `project_share.controller/service.viewShare`：可选 JWT，owner 才回传 `isOwner`。
- [x] 分享页：isOwner && !unlocked → 顶栏「解锁高清导出」；访客变现价值文案。

## R7 营收看板（ADDED-4）
- [x] 后端 `GET /billing/admin/overview`（role=root）：三窗口 GMV/订单数/付费用户数/在期会员数 + 最近 20 单。
- [x] 前端 `pages/admin/revenue` 页 + 路由 `/admin/revenue`（PrivateRoute + root 校验）。

## R8 测试
- [x] `billing.service.spec.ts`：会员下单定价/首单价、回调续费叠加、幂等、归属 404、mock 验签拒绝。
- [x] `quota.service.spec.ts`：会员额度 30+bonus、过期回落 3。
- [x] 前端 `__checks__/monetize.check.ts`：价格格式化、SKU 文案、回跳页参数解析等纯函数。

## R9 全量回归
- [x] 后端全量 jest（基线 40 套件/395 用例 + 本批新增）。
- [x] 前端全部 check 脚本 + 前后端 tsc 0 错误。

## R10 文档收尾
- [x] `docs/growth/增长运营一页纸.md` §6 增会员定价/触点/看板口径。
- [x] `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md` 追加本批记录。
- [x] `docs/deployment/语图项目部署运维手册.md`：手工 DDL（user 加列 + vip_order 建表）+ 新 env 说明 + mock 红线。
- [x] checklist.md 勾结。
