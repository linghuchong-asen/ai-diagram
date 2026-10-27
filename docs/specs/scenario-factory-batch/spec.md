# 场景工厂 · 十轮真实使用场景（scenario-factory-batch · Round G-P）Spec

> 日期：2026-10-26 ｜ 命题：开发有实际市场需求的新使用场景，运行十轮（头脑风暴 → 代码 → 测试）。
> 结论：**十轮全部完成并通过验收**。后端 jest **35 套件 / 348 用例全绿**（+14）；前端断言脚本 **13 个全绿（214/214，新增 5 个共 50 用例）**；前端 tsc 0 错误 + vite build 通过（4692 modules）；后端 tsc 0 错误；回归评估闸门 **54/54**。

## 架构决策：场景工厂（Round G 基建）

十个场景高度同构（粘贴 X → 解析 → 生成指令 → /trial 出图），故先建工厂再逐轮加场景：
- `pages/scenarios/registry.ts`：场景注册表（ScenarioConfig：文案 + 示例 + buildPrompt 纯函数 + 埋点渠道码）——**新增场景 = 加一个 builder + 注册一行，零路由改动**。
- `pages/scenarios/ScenarioPage.tsx`：通用场景页（`/s/:scenarioId`，示例填充 → buildPrompt → /trial）。
- `pages/scenarios/ScenariosIndexPage.tsx`：场景库索引页（`/scenarios`，场景发现与互跳）。
- 埋点统一 `scenario_submit`（channel 区分场景）——白名单只加一次，后续零后端改动。
- 领域解析逻辑全部为**纯函数**（builders/ 下），每个 builder 配 `__checks__` 断言脚本。

## 十轮场景与市场需求依据

| 轮 | 场景（路由） | 解析器核心 | 市场需求依据 | 断言 |
|---|---|---|---|---|
| G | 周报一图流 `/s/weekly-report` | 行分组解析（【】/冒号/量词防御） | 职场周报刚需文化 | 8 用例 |
| H | 建表语句转表关系图 `/s/sql-ddl` | CREATE TABLE 解析（列/PK/FK/注释/括号深度） | Eraser $45/席/月、中文免费版空档（调研） | 10 用例 |
| I | 伪代码转流程图 `/s/pseudo-code` | 缩进伪代码解析（中英文关键字/控制流统计） | ICSE 2025：流程图为最常用图型；编程教学 | 10 用例 |
| J | 链接→一图看懂（digest 页增强） | **后端** digestFetch 模块（SSRF 防御/启发式正文提取/缓存） | 粘链接比粘文字更自然 | 13 jest 用例 |
| K | 旅行行程图 `/s/travel` | Day1/D1/第N天 多标记归一解析 | 小红书行程攻略常青内容（可画场景页打法） | 10 用例（与 L 合并脚本） |
| L | JD 转面试准备图 `/s/jd-interview` | 技能/软技能词典命中 + 经验学历提取 | 秋招/春招求职刚需 | ↑ |
| M | 故障排查 SOP 图 `/s/troubleshooting` | 现象/排查/根因/解决/升级五段解析 | IT 支持/客服/运维 SOP 刚需 | 12 用例（M/N/O/P 合并脚本） |
| N | 审批流生成器 `/s/approval` | 链/条件/抄送三行式解析（角色链+加签规则） | 行政/HR 自定义审批流（超越静态模板） | ↑ |
| O | Git 提交转贡献图 `/s/git-log` | hex hash 行识别 + Conventional Commits 分类 | dev 复盘/述职/教学 | ↑ |
| P | OKR 拆解图 `/s/okr` | O/KR/动作三层归属解析 | 季度规划/年终述职 OKR 文化 | ↑ |

## 后端变更（Round J）

新增 `operationalModules/digestFetch/`：`POST /digest/url`（公开 + 限流）——SSRF 防御（协议白名单 + 内网/环回拒绝 + URL 服务端拼接）、Content-Type 白名单（仅 text/html|plain）、1MB/8s 上限、启发式正文提取（去 script/style/nav + 实体还原 + 短行过滤）、5 分钟缓存、`digest_url_fetch` 埋点。

## 验收证据汇总

| 项 | 结果 |
|---|---|
| 前端断言（13 脚本） | **214/214 通过**（新增 weekly-report 8 / sql-ddl 10 / pseudo-code 10 / travel-jd 10 / sop-approval-git-okr 12） |
| 后端 jest | 35 套件 / **348 用例**全绿（digest-fetch 13 + growth-track +1） |
| 前端 tsc / vite build | 0 错误 / 通过（4692 modules，含 9 个新场景页路由） |
| 后端 tsc | 0 错误 |
| 回归评估闸门 | 54/54 通过 |

## 运营衔接建议（非代码）

- 每个场景页是独立关键词落地页（`/s/sql-ddl` ↔ 「sql 转er图免费」、`/s/travel` ↔ 「旅行行程图模板」、`/s/jd-interview` ↔ 「面试准备清单」…），承接 SEO/社群流量时在 URL 带 `?ch=` 渠道码即可归因。
-  seasonal 战役：秋招（L）、年终述职（P/O）、毕业季（I）。
