# 付费转化增强批次（monetization-conversion-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P0（商业化/转化）
> 前置：`monetization-loop-batch` 已交付会员月卡 + 支付闭环 + 营收看板。本批解决「看见了链路，但转化触点不足」的三个缺口。

## Why

1. **导出是付费价值发生点，却没有转化动线**：未解锁用户点「导出 PNG/SVG」直接下载带水印文件——用户对「水印长什么样、¥1.9 能换什么」没有感知，growth 一页纸 §9.3 明确记录「导出无水印预览确认步骤」为待办。
2. **价格没有对外可见的落点**：价格信息只藏在预览页弹窗里，访客不登录、不生成图就看不到「免费/¥1.9/¥9.9」三档锚点——盈利方式需要一个公开的价格页。
3. **看板只有三窗口汇总，没有趋势**：营收「看得见」但不「看得清」——无法看出哪天开始有收入、会员与解锁的构成变化。

## What Changes（ADDED / MODIFIED）

### ADDED-1 导出水印预览确认（预览页，未解锁时）

- 未解锁用户点击「导出 PNG/SVG」→ 先弹确认框：展示水印效果说明（右下角低对比品牌水印 + 免费版标识）+「¥1.9 一次性去水印」主 CTA（点击直接走既有解锁动线）+「仍然带水印导出」次按钮（继续原导出）。
- 已解锁/会员用户零改动，导出体验不变（无弹窗）。免费用户导出能力**不被剥夺**（合规与口碑考量），只是增加一次价值感知。

### ADDED-2 公开价格页 `/pricing`

- 三卡对比：免费（每日 3 次+分享 +1、带水印）｜单图解锁 ¥1.9（首单 ¥0.9，一次解锁永久无水印）｜会员月卡 ¥9.9（首月 ¥5.9，每日 30 次 + 全站免水印）。
- 开通动线：会员卡「立即开通」→ 未登录跳登录（带 redirect 回 /pricing）→ 登录后直接创建会员订单走支付/沙箱分流（复用既有 pay/sponsor/轮询逻辑，弹窗内展示）；单图卡引导「生成一张图，预览页一键解锁」。
- 公开页勿加 PrivateRoute；与 Neon Dark 设计语言同构。

### ADDED-3 营收看板日趋势

- 后端 `AdminRevenueOverview` 新增 `dailyTrend`：近 14 天逐日 `{day, unlockGmvFen, vipGmvFen}`（订单表按 update_time 分日聚合，只计 paid）。
- 前端看板渲染纯 CSS 柱状图（堆叠：解锁+会员），零新依赖；日趋势下标注当日总额。

### MODIFIED-1 价格页入口接线

- 首页 TopLinks 加「价格」链接；分享页 footnote 加「价格」入口；预览页解锁弹窗 sponsor/pay 态底部加「查看完整价格 →」链接。

## 非目标

- 真实支付通道接入（等商户凭证）；年卡/季卡；优惠券/邀请返佣；漏斗埋点补全（share_view→register 归因仍缺，另批处理）。

## Impact

- 后端：billing.service（dailyTrend 聚合）+ spec 扩展。
- 前端：pages/preView（导出确认弹窗 + 弹窗价格链接）、pages/pricing（新增）、pages/admin/revenue（趋势图）、pages/home/landing、pages/share、router/routes、monetize.ts（趋势纯函数）。
- 测试：monetize.check 扩展（趋势数据处理）、billing.service.spec 扩展（dailyTrend）。
