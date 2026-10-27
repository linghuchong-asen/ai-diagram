# 任务清单（growth-quick-wins-batch1）

> 状态标记：[x] 完成 ｜ [ ] 未做。每项含验收标准。

## 后端

- [x] T1 `viewShare` 成功路径记 `share_view` 事件（含 projectId/shareToken，失败路径不记）
- [x] T2 新增 `POST /growth/track` 公开端点（ShareRateLimitGuard + 事件白名单 + 字段长度裁剪），ObservabilityModule 注册
- [x] T3 `CreateUserDto.channel` 可选字段 + `register` 事件携带 channel（sanitize ≤64）
- [x] T4 新增 `POST /share/duplicate/:token`（JWT）：复制画布为新项目（归属校验走公开读取链，重名加序号），记 `share_duplicate`
- [x] T5 试用台账：trialId 当日 1 → 2 次（env AI_TRIAL_PER_ID_PER_DAY 覆盖）、IP 当日 3 → 6、429 文案更新
- [x] T6 首单价：无 paid 订单用户按 FIRST_UNLOCK_PRICE_FEN（默认 90 分）下单并返回 firstOrder 标记
- [x] T7 配额用尽 hint 补「模板一键生成不消耗额度」

## 前端

- [x] T8 `utils/channel.ts`：入口捕获 ?ch=/utm_source/from → localStorage；main.tsx 挂载时调用一次
- [x] T9 分享页：复制按钮（登录复制 / 未登录带 redirect 跳登录）+ 热门模板推荐位 + CTA 点击埋点 + 水印可点
- [x] T10 登录/注册页支持 ?redirect= 回跳（注册成功 → 登录页携带 redirect）
- [x] T11 WatermarkOverlay 可选 link；导出 SVG/PNG 水印追加站点地址行
- [x] T12 AI 浮窗：试用拦截文案片段更新 + 注册引导卡文案强化；配额 429 → 三选一引导卡
- [x] T13 首页 chips 4 组场景按日轮换 + 占位文案轮换 + 「免费试 2 次」文案
- [x] T14 解锁弹窗：锚点文案 + 首单特惠标记（读 firstOrder）；billing.ts 类型同步

## 测试与文档

- [x] T15 后端 jest 全量通过（含新增用例：share_view/share_duplicate/首单价/试用 2 次/channel）
- [x] T16 前端 tsc + vite build 通过
- [x] T17 spec/checklist/changelog 文档更新
