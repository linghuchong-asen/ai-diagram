# 代码年报（annual-report）设计 · Round B 头脑风暴纪要

> 日期：2026-10-26 ｜ 依据：《魔性传播与商业化功能战略》赌注三之破门锤（A2）
> 定位：dev 圈年底自带刷屏属性的事件营销 + 开发者人群获客入口；技术上是「零 LLM 成本」的魔性功能样板。

## 一、机制设计（对照魔性报告的传播燃料）

1. **自我表达型传播**：用开发者自己的公开数据生成「可炫耀的截图」——网易云年度报告机制移植到 dev 圈；国内 GitHub Wrapped 类产品长期缺位（myyearwithgit 等开源款需要自建跑脚本，普通开发者用不起来），`/annual` 网页版填空即得。
2. **分享物是图片卡**（3:4，复用 Round A 的 drawCardBackground/drawCardBrand/wrapText）：图片不受微信外链监管、无备案域名也能传；卡片常驻品牌句 + 站点地址。
3. **通往编辑器的桥**（妙鸭教训）：年报页常驻 CTA「用一句话画出你的架构」→ /trial，把娱乐流量导向核心体验。

## 二、数据与成本架构（关键决策）

- **数据源**：只读公开 API，无 token、无登录、无个人信息收集——
  - GitHub：`GET /users/{u}//repos?per_page=100&sort=pushed`（未认证限额 60 次/时/IP）
  - Gitee：`GET /api/v5/users/{u}/repos?type=all&per_page=100`（对国内服务器更稳）
- **诚实口径**（不碰 GitHub events 的 90 天限制）：公开仓库总数、年内新建仓库、年内活跃仓库（pushed/updated 落在年内）、累计 stars、年内新建仓库获得的 stars、语言分布 Top5、最高星仓库、最近 push。**不承诺 commit 数**；卡片角标注明「基于公开仓库数据」。
- **零 LLM 成本**：统计在服务端算、卡片在前端 Canvas 画 —— 完全不消耗 AI 额度，是魔性功能里唯一零 Token 成本的形态（与 A1/A3 的 Prompt 成本形成对照）。
- **防刷**：服务端内存缓存 5 分钟（同 source:user:year 直接命中）+ IP 限流守卫 + 单页 100 仓库截断标记。

## 三、边界与降级

- 上游 404 → 404「用户不存在」；403（GitHub 限额）→ 429 提示稍后再试；网络异常 → 502。
- 用户名白名单校验 `^[A-Za-z0-9_-]{1,64}$`（防注入/防 SSRF 探测内网地址——URL 由常量拼接）。
- 私有仓库/commit 级统计/多年对比 → 留作后续付费包（¥9.9 妙鸭锚点），本期仅埋 `annual_generate` 与 `card_export(channel:annual)`。

## 四、落地清单

- 后端：`operationalModules/annual/`（service + controller + module），GET `/annual/report?source=&user=&year=`（公开 + 限流）。
- 前端：`pages/annual/` 公开页（输入用户名 + GitHub/Gitee 切换 + 年份）→ 统计卡渲染 + `utils/annualCard.ts` 导出 3:4 年报卡；路由 `/annual`；首页/脑洞页入口。
- 埋点：服务端 `annual_generate`；前端 `card_export`（channel: annual）。
- 测试：annual.service 单测（聚合口径/上游错误映射/缓存命中/参数校验/埋点）。
