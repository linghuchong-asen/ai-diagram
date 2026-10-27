# 增长快赢批次一（growth-quick-wins-batch1）Spec

> 状态：实施中 ｜ 日期：2026-10-26 ｜ 优先级：P0（增长）
> 依据：`docs/growth/语图-推广运营体验-多轮头脑风暴-2026-10.md` §3.2 快赢区（影响大 × 成本低）
> 原则：全部动作不依赖 R3 导出/备案域名/支付通道验证，单人两周内可交付。

## Why

头脑风暴报告 Round 3 收敛结论：当前增长最大的问题不是渠道不够，而是**漏斗中段不可测**（无 share_view、无 CTA 点击、无渠道归因），以及若干已被竞品验证的转化摩擦点（免登录仅 1 次、注册墙过早、付费无锚点、额度用尽硬拦截）。本批次以最小代码量落地快赢区 10 项中的 8 项纯代码项（知乎卡位/导航站收录为运营动作，og:image 待设计资产，均不在本批）。

## What Changes（ADDED / MODIFIED）

### ADDED-1 分享页浏览与 CTA 埋点（QW1）
- `viewShare` 成功路径记 `share_view` 事件（projectId + shareToken）。
- 新增公开端点 `POST /growth/track`（IP 限流复用 ShareRateLimitGuard，事件名白名单 `share_cta_click` / `share_template_click`），承接分享页 CTA 点击埋点。

### ADDED-2 注册渠道归因（QW1）
- `CreateUserDto` 新增可选 `channel`；`register` 事件携带 channel。
- 前端入口（main.tsx）捕获 `?ch=` / `utm_source` / `from` 参数存 localStorage，注册时随请求提交（sanitize ≤64 字符）。

### ADDED-3 分享页「复制这张图开始编辑」（QW2，Figma Duplicate 式）
- 新增 `POST /share/duplicate/:token`（JWT）：公开读取的画布复制为新项目（归属当前用户，名称 `原名 · 副本`，重名追加序号），记 `share_duplicate` 事件。
- 分享页新增按钮：未登录跳登录并带 redirect 回分享页；登录后复制并直达编辑器。
- 分享页底部新增 2 个热门模板推荐位（静态，链接 /trial?q=），点击记 `share_template_click`。

### MODIFIED-1 水印可回流（QW3）
- 展示层水印组件新增可选 `link`：分享页水印文案变为可点击链接回首页（仅文案区域响应点击，不遮挡画布）。
- 导出层（PNG/SVG）水印在品牌文案下追加一行站点地址（当前 origin），导出物可按图回流。

### MODIFIED-2 免登录试用 1 次 → 2 次（QW4，A/B 前置默认值）
- trialId 当日上限 1 → 2（env `AI_TRIAL_PER_ID_PER_DAY` 可覆盖）；同 IP 当日 3 → 6（防校园 NAT 误伤）。
- 429 文案改为「今日免费试用次数已用完（每日 2 次），注册后每日可生成 3 次」；前端拦截识别片段同步更新。
- 首页/试用页文案从「免费试一次」改为「免费试 2 次」；注册引导卡文案强调「注册保存这幅图并继续编辑」。

### MODIFIED-3 首单优惠 + 价格锚点（QW5）
- `createUnlockOrder`：该用户名下无 paid 订单时按首单价（env `FIRST_UNLOCK_PRICE_FEN`，默认 90 分）下单，返回 `firstOrder: true`；否则原价（`UNLOCK_PRICE_FEN`，默认 190 分）。金额仍只信服务端。
- 解锁弹窗 pay/sponsor 两态补充锚点文案（「同类工具解锁一年 ¥199+，语图按张付费、一次解锁永久有效」）与「首单特惠」标记。
- 额度用尽提示（后端 hint）补充「模板一键生成不消耗额度」。

### MODIFIED-4 首页 chips 场景化按日轮换（QW6 部分）
- 首页快捷 chips 从固定 3 条改为 4 组场景（校园毕设/职场/电商/研发）按天轮换，输入框占位文案同步轮换；og:image 待设计资产产出后另行接入（本批不做）。

### MODIFIED-5 额度用尽三选一（QW7）
- AI 浮窗识别配额 429（AI_QUOTA_EXCEEDED），不再按普通错误展示，改为引导卡三条出路：①去分享领 +1 次（有 projectId 时直达预览页分享）②逛模板中心（不耗额度）③明日再来。

## Impact

- 后端：observability/（新增 growth-track.controller）、projectShare/、ai/（ai.service 试用台账）、billing/、user/（dto + service）。
- 前端：pages/share/、pages/shared/WatermarkOverlay、utils/exportImage、pages/ai/ai_float_window、pages/home/landing、pages/preView/（index + billing 类型）、pages/login/（login/register redirect）、utils/channel（新增）、main.tsx。
- 测试：project_share.service.spec / billing.service.spec / ai.service.spec / user.service.spec 同步扩充；全量 jest 须绿。
- 无数据库结构变更、无新依赖、无 BREAKING（新增字段均可选）。
