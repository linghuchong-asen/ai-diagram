# 模板使用统计批次（template-usage-stats-batch）Spec

> 状态：已实施（2026-10-27，全量回归绿）｜ 日期：2026-10-27 ｜ 优先级：P1（增长/内容运营）
> 前置：社区模板批次收口。目标：给社区模板装上「热度仪表」——投稿激励（被复制 N 次送会员）与社区精选热度排序的数据基础。

## Why

社区模板上架后没有任何反馈数据：投稿者不知道作品有没有人用，运营不知道哪类内容受欢迎。「查看数 / 复制数」是最小可行的热度信号——复制数（Figma Duplicate 式强意图）尤其有价值。

## What Changes

- `community_template` 新增 `view_count` / `copy_count`（int default 0）。
- `projectShare.service`：`viewShare` 成功 → `view_count + 1`；`duplicateShare` 成功 → `copy_count + 1`（按 shareToken 命中，raw SQL 原子自增，try/catch 旁路——统计绝不阻断查看/复制主链路；模板中心外的普通分享 token 无命中行，零成本空转）。
- `GET /template/community` 返回 `viewCount/copyCount`；社区精选按 **copyCount 降序 → createTime 降序** 排序（热门优先）。
- 模板中心社区卡片展示「N 次查看 · M 次复制」。

## 非目标

- 投稿奖励发放（被复制 N 次送会员——数据积累后另批）；全站官方模板的使用统计（静态模板无 token）。

## Impact

- 后端：projectShare（service 计数 + module 注册 community_template 仓库）、template（service 返回计数）。
- 前端：pages/templates（卡片热度文案）。
- 数据库：community_template 加两列（DDL ⑨）。
- 测试：projectShare.service.spec（两处计数）、template.service.spec（列表字段）。
