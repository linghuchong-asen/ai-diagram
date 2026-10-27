# 任务清单与验收（annual-report-batch · Round B）

> 验证时间：2026-10-26 ｜ 结论：**全部通过**。后端 jest **34 套件 / 332 用例全绿**（+1 套件 +7 用例）；后端 tsc 0 错误；前端 tsc 0 错误、vite build 通过（4676 modules）。

## 任务

- [x] T1 后端 `operationalModules/annual/`：service（聚合口径/错误映射/缓存 5min/用户名白名单）+ controller（公开 + 限流）+ module 注册
- [x] T2 前端 `pages/annual/`：GitHub/Gitee 切换 + 用户名 + 年份 → 统计宫格 + 语言/最星仓库展示 + 错误态重试
- [x] T3 前端 `utils/annualCard.ts`：年报卡 Canvas 导出（复用分享卡工厂视觉，诚实口径注常驻）
- [x] T4 路由 `/annual`（公开页）+ 首页入口链接 + 页内留存桥 CTA（→ /trial）
- [x] T5 埋点：服务端 `annual_generate`（缓存命中不计）；前端 `card_export(channel:annual)`
- [x] T6 单测 7 用例：GitHub 聚合口径 / Gitee 归一化 / 截断标记 / 404→404、403→429、网络→502 / 参数校验不打上游 / 缓存去重（大小写不敏感）/ 空仓库零值

## 验收证据

| 项 | 结果 |
|---|---|
| annual.service.spec | 7/7 passed |
| 后端全量 jest | 34 suites / 332 tests passed |
| 后端 tsc --noEmit | exit 0 |
| 前端 tsc / vite build | 0 错误 / 通过 |
