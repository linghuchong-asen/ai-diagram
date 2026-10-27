# 魔性传播批次一 · 分享卡工厂（viral-card-batch）Spec

> 状态：实施中 ｜ 日期：2026-10-26 ｜ 优先级：P0（获客）
> 依据：`docs/growth/语图-魔性传播与商业化-功能战略头脑风暴-2026-10.md` §3.2 赌注一（第 1-3 周）
> 命题：无备案域名下，传播介质必须是「自带回流的图片卡」——本批落地卡片工厂与两个魔性入口页。

## Why

战略报告的三个前提：①图片分享不受微信外链监管（链接受限）；②魔性功能需要「成品即内容」的分享物；③语图引擎已可生成图，缺的是把「图 + 提示词 + 品牌」合成一张适合小红书/朋友圈的竖版卡片的能力。赌注一 = 分享卡工厂（公共地基）+ 两个纯引擎复用的魔性入口（A1 一图看懂 / A3 脑洞显影卡）。

## What Changes（ADDED / MODIFIED）

### ADDED-1 分享卡工厂（utils/shareCard.ts）
- `exportDiagramCard({ graph, title })`：X6 画布 → SVG → 合成 1080×1440（3:4）PNG 卡片下载。
- 卡片版式：暗色 Neon 风背景 + 顶部 YUTU CARD 标签 + 提示词标题（CJK 自动换行、最多 5 行截断）+ 居中适配的图 + 底部品牌句「一句话，生成你的流程图」+ 站点地址（回流入口，备案后自动升级为域名）。
- 导出公共 helper：`renderGraphToSvg`（复用 exportImage 的 SVG 管线）、`wrapText`/`drawCardBackground`（Round B 年报卡复用）。
- 卡片是传播物，品牌句常驻（这不是水印，是分享物的署名，付费也不移除）。

### ADDED-2 「脑洞显影卡」入口页（/fun）
- 公开页：6 个预置梗场景（拖延症决策树 / 点外卖决策流 / 周一精神状态 / 答辩心理活动 / 双十一剁手 / 开黑甩锅）+ 自定义输入 → 跳 `/trial?q=` 走免登录试用链路生成。
- chips 点击记 `fun_chip_click`（前端上报，经 /growth/track）。

### ADDED-3 「一图看懂」入口页（/digest）
- 公开页：粘贴文章/公告/说明文本（匿名 ≤500 字，与试用链路上限一致；页内提示注册后 2000 字）→ 跳 `/trial?q=总结成一张图：...`。
- 提交记 `digest_submit`。

### ADDED-4 卡片导出集成
- 试用页顶栏新增「导出分享卡」按钮（标题取试用草稿的 prompt；空画布时提示先生成）。
- 预览页工具栏新增「分享卡」按钮（标题取项目名）。
- 均记 `card_export` 事件。

### MODIFIED-1 growth-track 白名单
- 新增 `card_export` / `fun_chip_click` / `digest_submit` 三个客户端事件（白名单同步扩展）。

### MODIFIED-2 首页入口
- 落地页 Hero 下方新增「魔性玩法」入口链接（脑洞显影卡 · 一图看懂）。

## Impact

- 前端：utils/shareCard.ts（新增）、pages/fun/（新增）、pages/digest/（新增）、routes、landing、trial/index、preView/index、utils/exportImage.ts（导出 helper）。
- 后端：observability/growth-track.controller.ts（白名单 +3）+ 新增单测。
- 测试：growth-track.controller.spec（新增）；全量 jest、前端 tsc/build 必须全绿。
- 无数据库变更、无新依赖、无 BREAKING。
