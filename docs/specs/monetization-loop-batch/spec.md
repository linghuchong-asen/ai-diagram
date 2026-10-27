# 商业化闭环批次（monetization-loop-batch）Spec

> 状态：已实施（2026-10-26 晚，全量回归绿）｜ 日期：2026-10-26 ｜ 优先级：P0（商业化）
> 目标：让「盈利方式」看得见 —— 一条可演示、可对账、可持续的收钱链路。
> 依据：`docs/growth/增长运营一页纸.md` §6 付费转化、`docs/growth/语图-魔性传播与商业化-功能战略头脑风暴-2026-10.md`。

## Why（痛点 → 现状证据）

领导诉求「要能够看得见的盈利方式」。当前商业化的断点：

1. **收不了钱**：虎皮椒通道未配置（`XUNHU_APP_ID/SECRET` 缺失），所有下单都落 `mode:'sponsor'`，无自动解锁、无人工后台 —— 支付链路从未端到端跑通过。
2. **付费回跳页 404**：支付适配器 callback 指向 `/unlock-result`，但前端路由表没有这个页面，用户付完钱落地 404（转化链路硬伤）。
3. **只有一次性收入**：仅 ¥1.9/张按次解锁，无订阅制 —— 收入天花板低、不可预期。
4. **分享页（最大流量面）无变现入口**：访客只能注册，看不到「花钱去水印」的价值主张。
5. **营收不可见**：没有任何页面能看到 GMV / 订单 / 会员数，运营取数要登服务器 grep 日志。

## What Changes（ADDED / MODIFIED）

### ADDED-1 会员订阅制（月卡）

- 新实体 `vip_order`（uuid / userId / amount / status pending→paid / channel / channelOrderNo / sku=`vip_month`），与 `unlock_order` 同构同安全原则。
- `user` 表新增 `vip_expire_time timestamp NULL`；续费叠加规则：当前 VIP 未到期则「现有到期时间 + 30 天」，已过期/首次则「now + 30 天」。
- 后端端点（BillingModule 内）：
  - `POST /billing/vip/order`（JWT）：创建月卡订单，定价 `VIP_MONTH_PRICE_FEN`（默认 990 分），返回 `{orderId, mode:'pay'|'sponsor', payUrl?, firstOrder?}`，金额只信服务端；
  - `GET /billing/vip/order/:orderId`（JWT + 归属校验）：查单（轮询支付结果）；
  - `GET /billing/vip/status`（JWT）：当前会员态 `{vip, vipExpireTime}`。
- 支付回调成功（与解锁单同一验签闸门）→ 订单置 paid → 用户 `vip_expire_time` 叠加 → 记 `vip_pay` 增长事件（金额、是否首单口径同 `unlock_pay`）。

### ADDED-2 模拟支付通道（沙箱，让收款链路可演示）

- 支付适配器工厂：env `PAY_CHANNEL` = `xunhupay`（默认，生产）/ `mock`（沙箱演示）。
- `MockPayAdapter`：`PAY_CHANNEL=mock` 且 `MOCK_PAY_SECRET` 已配置时，`payUrl` 指向站内 `/mock-pay?orderId=..&sign=HMAC_MD5(orderId, MOCK_PAY_SECRET)`；未配置 secret 视为未配置通道（回落 sponsor，防止裸奔）。
- 新公开端点 `POST /billing/notify/mock`：校验 `sign` 后走与虎皮椒回调完全相同的放行语义（`applyPaid`：幂等、先 order 后权益）。**红线：生产严禁 `PAY_CHANNEL=mock`**（任何人可自己「支付成功」），文档与 env 注释双重提示。
- 前端新增 `/mock-pay` 页面：展示订单金额 + 「模拟支付成功」按钮（仅演示环境可达）。

### ADDED-3 支付回跳页 `/unlock-result`（补 404 缺口）

- 支付适配器 callback 改为携带订单上下文：`/unlock-result?orderId=..&projectId=..&kind=unlock|vip`。
- 回跳页轮询查单（复用 3s×10 节奏）：paid → 提示成功并跳回 `/preview/:projectId`（会员单跳首页）；超时/未支付给出「未检测到支付」与重试指引。

### ADDED-4 营收看板（管理端）

- 后端 `GET /billing/admin/overview`（仅 `role=root`）：一次返回今日/7 日/30 日三窗口的解锁 GMV、会员 GMV、订单数、付费用户数、在期会员数、最近 20 笔订单明细（含类型/金额/状态/时间）。
- 前端新增 `/admin/revenue` 页（PrivateRoute + root 校验）：GMV 卡片 + 订单表 + 口径说明。盈利第一次「看得见」。

### ADDED-5 分享页变现入口

- `GET /share/view/:token` 可选鉴权：请求带合法 JWT 且为项目归属人时回传 `isOwner: true`（访客不回传，不泄露归属）。
- 分享页：`isOwner && !unlocked` → 顶栏出现「解锁高清导出」按钮直达 `/preview/:projectId`；非 owner 未解锁访客在底部转化区看到「去水印高清导出你的图」价值文案（承接复制/注册动线）。

### MODIFIED-1 会员权益 ①：生成额度

- `QuotaService`：会员生效期内生成额度 = `VIP_DAILY_GENERATE_LIMIT`（默认 30）+ 当日分享奖励；免费用户维持 3 + 奖励。`DailyUsageView` 新增 `vip` / `vipExpireTime` 字段，前端沿用原字段展示正确额度。

### MODIFIED-2 会员权益 ②：全站免水印

- 水印判定上收服务端：`GET /project/:id` 与分享视图的 `unlocked` 输出改为 `project.unlocked || 会员生效期`——前端预览页/分享页/导出链路零改动即生效（导出、水印、分享页全链路去水印）。

### MODIFIED-3 解锁弹窗升级为「付费中心」动线

- 预览页解锁弹窗支持双 SKU 切换：单次解锁（¥1.9，首单 ¥0.9）/ 会员月卡（¥9.9：每日 30 次生成 + 全站无水印）。
- 会员态用户弹窗显示「会员生效中，导出无水印」（不再展示下单入口）。

## 非目标（本批不做）

- 真实支付商户开通与回调验证（虎皮椒字段以官方文档为准，接入时人工比对，本批提供工厂位）。
- 年卡/季卡、邀请返佣、优惠券（记入增长文档待办）。
- 会员专属模板/功能差异化（先跑通额度+去水印两大权益）。

## Impact

- 后端：billing/（service/controller/module/adapters/entities）、user/（entity）、ai/quota/、projectManager/（:id 输出）、projectShare/（view 输出）。
- 前端：pages/preView/（index/billing/server）、pages/share/、pages/mockPay（新增）、pages/unlockResult（新增）、pages/admin/revenue（新增）、router/routes。
- 数据库（开发 synchronize 自动；生产手工 DDL 见 deployment 手册）：`user` 加列 `vip_expire_time`；新表 `vip_order`。
- 安全红线：金额只信服务端、回调必验签、mock 通道 env 显式开启且仅限非生产演示。
