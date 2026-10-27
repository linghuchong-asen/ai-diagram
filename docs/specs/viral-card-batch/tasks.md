# 任务清单与验收（viral-card-batch）

> 验证时间：2026-10-26 ｜ 结论：**全部通过**。后端 jest **33 套件 / 325 用例全绿**（+1 套件 +6 用例）；前端 tsc 0 错误、vite build 通过。

## 任务

- [x] T1 `utils/shareCard.ts` 分享卡工厂：1080×1440 3:4 暗色卡，标题折行截断、画布图等比居中、品牌句+站点地址常驻；导出 `renderGraphToSvg/wrapText/drawCardBackground` 供年报卡复用
- [x] T2 `/fun` 脑洞显影卡页：6 个预置梗场景（拖延症/外卖/周一/答辩/双十一/开黑）+ 自定义输入 → /trial 试用链路
- [x] T3 `/digest` 一图看懂页：≤500 字（与试用 schema 一致）+ 字数统计 + 示例 chips + 注册可 2000 字提示
- [x] T4 路由 `/fun` `/digest`（公开页）+ 首页「魔性玩法」入口链接
- [x] T5 试用页顶栏「导出分享卡」（标题取试用草稿 prompt；空画布给行动提示）
- [x] T6 预览页工具栏「分享卡」按钮（标题取项目名）
- [x] T7 growth-track 白名单 +3（card_export / fun_chip_click / digest_submit）
- [x] T8 `growth-track.controller.spec.ts` 新增 6 用例（白名单收/拒、字段清洗截断、缺省字段）

## 验收证据

| 项 | 结果 |
|---|---|
| 后端 jest | 33 suites / 325 tests passed |
| 前端 tsc --noEmit | 0 错误 |
| 前端 vite build | 通过（bundle 含新页面） |
| AGENTS.md 规范 | 全部新文件带中文头注释；spec/tasks/checklist 齐备 |
