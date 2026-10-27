# 模板使用统计批次 验收清单（checklist.md）

> 实测日期：2026-10-27。

## 功能验收

- [x] 查看计数：viewShare 成功 → view_count +1（按 shareToken 命中社区模板；普通分享零成本空转）—— projectShare.service.spec。
- [x] 复制计数：duplicateShare 成功 → copy_count +1（duplicate 内部复用 viewShare 校验，断言按调用序列区分两列）。
- [x] 旁路语义：计数 SQL 失败 → 查看/复制主链路不受影响（静默吞错）。
- [x] 列表口径：GET /template/community 返回 viewCount/copyCount，社区精选按复制数降序 → 时间降序（热门优先）。
- [x] 前端：社区卡片展示「N 次查看 · M 次复制」。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：43 套件 / 476 用例全绿（净增 3）。
- [x] 前端全部 check 0 失败；前后端 tsc 0 错误。

## 文档验收

- [x] changelog 追加；deployment 手册 DDL ⑨（community_template 加两列）；spec/checklist 收口；记忆更新。

## 附：CTA 埋点补全（同轮小批）

- [x] `community_template_click` 进客户端白名单 + 模板中心社区卡片埋点（漏斗 click → view → duplicate）；全量回归 477 用例绿。
