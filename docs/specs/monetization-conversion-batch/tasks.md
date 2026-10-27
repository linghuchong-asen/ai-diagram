# 付费转化增强批次 任务清单（tasks.md）

## R1 规格文档
- [x] spec.md / tasks.md / checklist.md 建档。

## R2 导出水印预览确认
- [x] 预览页未解锁导出 PNG/SVG 前弹确认框（水印效果说明 + ¥1.9 去水印 CTA + 继续导出）。

## R3 价格页 /pricing
- [x] 三卡对比页（免费/单图/会员）+ 登录态分流的会员开通动线（复用 createVipOrder/轮询/sandbox 分流）。

## R4 入口接线
- [x] 首页 TopLinks「价格」、分享页 footnote「价格」、预览页解锁弹窗「查看完整价格」。

## R5 看板日趋势
- [x] 后端 overview 增 dailyTrend（14 天，分 unlock/vip）；前端纯 CSS 堆叠柱状图。

## R6 测试
- [x] monetize.check 扩展：趋势归一化/最大值/空数据纯函数。
- [x] billing.service.spec 扩展：dailyTrend 聚合口径（只计 paid、分日、双订单类型）。

## R7 全量回归
- [x] 后端 jest 全量绿；前端全部 check 绿；前后端 tsc 0 错误。

## R8 文档收尾
- [x] changelog / growth 一页纸 / checklist 勾结 / 记忆更新。
