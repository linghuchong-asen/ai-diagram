# 社区模板批次（community-template-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P1（增长/内容长尾）
> 前置：留存与裂变加强批次已收口。目标：让用户作品变成获客长尾（UGC），模板中心从「官方 20 条」变成「官方 + 社区精选」。

## Why

模板中心是 SEO/社群获客的长尾引擎（growth 一页纸 §5），但内容全部官方预置——产能有限。用户每天生成大量真实场景图（请假、报销、毕设答辩……），把优质作品转为公开模板（带署名），既能丰富模板长尾，又给投稿者「被看见」的荣誉激励，与签到/邀请形成第三条自驱动机。

## What Changes

### ADDED-1 社区模板投稿与审核（后端）

- 新表 `community_template`：projectId 唯一（一个项目一次投稿）、ownerId/ownerName（署名）、title/description、shareToken（复用分享体系）、status `pending → approved | rejected`（审核单向，驳回可重新投稿）。
- `POST /template/submit/:projectId`（JWT + 归属校验）：投稿——自动确保项目有分享 token（查 project_share，无则直建，**不发分享奖励不记 share_create**，防投稿套利额度）；status=pending；`community_submit` 事件。
- `GET /template/community`（公开 + 限流）：approved 列表（≤24 条，倒序）。
- `GET /template/community/pending`（仅 root）+ `POST /template/community/review/:id`（仅 root，approve/reject）：审核（合规红线：UGC 必审后上架）。

### ADDED-2 前端动线

- 预览页工具栏「投稿模板」按钮（弹窗确认，描述选填）→ 投稿成功提示「审核通过后将在模板中心展示」。
- 模板中心新增「社区精选」分区：approved 模板卡片（标题/描述/署名）+「查看成品」跳 `/share/:token`（免登录看图，页内已有复制/注册转化动线）。
- 营收看板页新增「社区模板审核」卡片（root）：pending 列表 + 通过/拒绝按钮。

## 非目标

- 投稿激励（模板被使用次数统计与奖励）、分类标签、搜索（后续按数据决定）；模板中心 SEO 静态化。

## Impact

- 后端：operationalModules/template/（entity/service/controller/module）。
- 前端：pages/templates（server + index）、pages/preView、pages/admin/revenue。
- 数据库：新表 `community_template`（DDL ⑧）。
