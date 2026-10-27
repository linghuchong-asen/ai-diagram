# 验收清单（growth-quick-wins-batch1）

> 验证时间：2026-10-26 ｜ 验证人：AI Agent（产品负责人指派）
> 结论：**全部通过**。后端 jest 32 套件 / 319 用例全绿（原 230 → 319，+89）；前端 tsc 0 错误、vite build 通过；后端 tsc 0 错误。

## 后端

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 1 | `viewShare` 成功路径记 `share_view`（projectId+token），404 不记 | ✅ | project_share.service.spec（2 用例） |
| 2 | `POST /growth/track` 白名单（share_cta_click/share_template_click）+ 限流 + 字段截断 | ✅ | growth-track.controller.ts（白名单外 400） |
| 3 | `register` 事件携带 channel（截断 ≤64、去控制字符、缺省不写键） | ✅ | user.service.spec（2 新用例） |
| 4 | `POST /share/duplicate/:token`：复制画布 + 重名加序号 + 不继承解锁态 + 记 share_duplicate | ✅ | project_share.service.spec（3 用例） |
| 5 | 试用 trialId 日限 1→2（env AI_TRIAL_PER_ID_PER_DAY 可回调为 1）、IP 日限 3→6、文案更新 | ✅ | ai.service.spec（含 env 回调用例） |
| 6 | 首单价：无 paid 订单 → FIRST_UNLOCK_PRICE_FEN（默认 90 分）+ firstOrder 标记；unlock_pay 事件含 firstOrder | ✅ | billing.service.spec（3 新用例 + 2 修正） |
| 7 | 配额用尽 hint 补「模板一键生成不消耗额度」 | ✅ | quota.service.ts（jest 全绿覆盖） |

## 前端

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 8 | `utils/channel.ts` 捕获 ?ch=/utm_source/from（首触达优先、字符白名单、≤64） | ✅ | tsc 0 错误 + main.tsx 挂载调用 |
| 9 | 分享页：复制按钮（登录复制直达编辑器 / 未登录 redirect 跳登录）+ 2 模板推荐位 + CTA 埋点 | ✅ | share/index.tsx + server.ts |
| 10 | 登录/注册 ?redirect= 双向透传（分享页→注册→登录→回分享页） | ✅ | login.tsx / register.tsx / server.ts |
| 11 | 水印可点（link 模式，仅文案区响应）+ 导出 SVG/PNG 水印追加站点地址行 | ✅ | WatermarkOverlay.tsx + exportImage.ts + tech-theme.css |
| 12 | 浮窗：TRIAL_USED 文案片段对齐 + 注册卡文案强化；配额 429 → 三选一引导卡（分享+1/模板/明日） | ✅ | ai_float_window.tsx |
| 13 | 首页 chips 4 组场景按日轮换 + 占位轮换 + 「免费试 2 次」文案 | ✅ | landing.tsx |
| 14 | 解锁弹窗锚点文案 + 首单特惠标记（firstOrder） | ✅ | preView/index.tsx + billing.ts |

## 整体

| # | 验收项 | 结果 | 证据 |
|---|---|---|---|
| 15 | 后端 jest 全量 | ✅ | 32 suites / 319 tests passed |
| 16 | 前端 tsc + vite build | ✅ | 0 errors；4670 modules transformed |
| 17 | 后端 tsc --noEmit | ✅ | exit 0 |
| 18 | AGENTS.md 规范：中文注释 + 文件头注释 + 功能变更文档 | ✅ | 全部新增/修改文件带头注释；spec/tasks/checklist/changelog 齐备 |

## 未纳入本批（记录在案）

- og:image：待设计资产（品牌封面图）产出后接入，当前无可用图片资源。
- 知乎卡位 / AI 导航站收录 / 公众号兑换码：运营动作非代码项，见头脑风暴报告 §3.2。
- 支付通道（虎皮椒）回调验证：上线前须人工比对字段名（一页纸 §9.5 红线），firstOrder 定价仅在通道配置后真实生效。
