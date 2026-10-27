# 付费转化增强批次 验收清单（checklist.md）

> 实测日期：2026-10-27。前置：`monetization-loop-batch`（会员月卡 + 支付闭环 + 看板）已收口。

## 功能验收

- [x] 导出水印预览确认：未解锁用户点「导出 PNG/SVG」→ 弹「导出预览」（水印效果示意 + ¥1.9 去水印 CTA + 仍然带水印导出）；已解锁/会员零改动直接导出 —— `preView/index.tsx` runExport 两段式。
- [x] 价格页 `/pricing`：免费/单图/会员三卡对比（公开页勿加 PrivateRoute）；会员卡已登录直接下单（pay 跳转+轮询 / sponsor 降级 / paid 成功态），未登录跳登录带 redirect=/pricing 回流；在期会员 CTA 变「续费会员月卡」并显示到期日 —— `pages/pricing/index.tsx`。
- [x] 看板日趋势：`AdminRevenueOverview.dailyTrend` 近 14 天（缺日补 0，只计 paid，分 unlock/vip）；前端纯 CSS 堆叠柱状图（零新依赖），悬停看当日金额 —— `billing.service.getAdminOverview` + `pages/admin/revenue`。
- [x] 入口接线：首页 TopLinks「价格」、分享页 footnote「价格 →」、预览页解锁弹窗 pay/sponsor 态「查看完整价格 →」。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：**42 套件 / 447 用例全绿**（+2：buildDailyTrend 纯函数与看板 dailyTrend 断言）。
- [x] 前端全部 check：**14 个脚本 217 断言全绿**（monetize.check 13 → 17，新增 buildTrendView 四用例）。
- [x] 前后端 tsc 0 错误。

## 文档验收

- [x] growth 一页纸：§6 触点补价格页与导出预览确认、§9.3 勾掉「导出无水印预览」待办。
- [x] changelog 追加本批章节。
- [x] tasks.md 勾结、本清单收口。
