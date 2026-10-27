# 邀请裂变批次 验收清单（checklist.md）

> 实测日期：2026-10-27。前置：monetization-loop-batch / monetization-conversion-batch 已收口。

## 功能验收

- [x] 邀请码：新用户注册自动生成（@BeforeInsert，8 位无歧义字符集）；存量用户 `/billing/invite/me` 懒生成（唯一冲突重试）—— billing.service.spec getInviteHome 两用例。
- [x] 注册归因：合法邀请码 → `invited_by` 落库 + 触发奖励；非法/不存在码静默忽略，注册永不失败 —— user.service.spec 三用例。
- [x] 双向奖励：邀请人 +1 天会员（在期顺延 / 未开通从当天起），被邀请人当日 +2 次生成 —— applyInviteRewards 用例。
- [x] 防刷：奖励日上限 3 天（`UPDATE WHERE < cap` 原子自增 + INSERT ON CONFLICT DO NOTHING 兜底，防并发超发）；自邀请直接跳过 —— 用例覆盖。
- [x] 旁路语义：奖励/归因链路抛错 → 注册仍成功 —— 用例覆盖。
- [x] `/invite` 活动页：邀请码 + 一键复制链接 + 规则 + 战果（已邀请人数/会员到期日）—— 前端编译与 check 覆盖纯函数口径。
- [x] 入口捕获：`?ic=` → localStorage（白名单清洗、首次触达优先）→ 注册表单自动回填随请求提交 —— sanitizeInviteCode/buildInviteLink 四用例。
- [x] 入口接线：首页「邀请有礼」、价格页底部裂变入口；看板「累计邀请注册」卡片。

## 回归验收（实测 2026-10-27）

- [x] 后端全量 jest：**42 套件 / 456 用例全绿**（净增 9：邀请奖励 6 + 注册归因 3）。
- [x] 前端全部 check：**14 个脚本 221 断言全绿**（monetize.check 17 → 21）。
- [x] 前后端 tsc 0 错误。

## 文档验收

- [x] growth 一页纸新增「§5.5 获客引擎 D：邀请裂变」（机制/动机/渠道打法/埋点口径/合规红线）。
- [x] changelog 追加本批章节。
- [x] deployment 手册手工 DDL ⑥（user 两列 + 唯一索引 + usage 计数列）。
- [x] tasks.md 勾结、spec.md 状态置「已实施」、记忆更新。
