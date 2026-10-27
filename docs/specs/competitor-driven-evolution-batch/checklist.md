# Checklist · 竞品驱动演进二十轮（competitor-driven-evolution-batch）

> 验收闸门：逐项可验证；全部勾选后方视为批次完成。
> **验收结论（2026-10-26）：全部通过。**
> 后端 jest 全量 **42 套件 / 417 用例全绿**（本批次新增/扩展 spec 共 5 个：graph.template-shortcut 8、graph.artifact +3、form.router +5、artifact-injection-hardening 4、template.service +1）；
> 前端断言脚本 **24 个全绿**（本批次新增 10 个：mermaid-parser 28、plantuml-parser 11、dsl-import 6、table-scoring 9、timeline-sort 9、followup-suggest 4、download-artifact 7、history-stack 5、artifact-drafts 7、multi-artifact-scenarios 16）；
> 前后端 tsc 0 错误；前端 vite build 通过。

## 主线 A · DSL 互操作（G1）
- [x] Mermaid flowchart 解析：方向/九形状/五箭头/边标签/链式/裸引用/start-end 出度修正/自环防御（mermaid-parser.check 28/28）
- [x] Mermaid 高级语法：subgraph→subprocess、样式指令行跳过、`&` 并联、未闭合 end 提示（同上扩展用例）
- [x] PlantUML activity 解析：if/else、while 回流、repeat、fork、标签箭头、partition/note 跳过、detach（plantuml-parser.check 11/11）
- [x] 方言识别 + 浮窗导入入口：围栏剥离、识别失败可读提示、解析成功走 preview→应用链路（dsl-import.check 6/6 + tsc）
- [x] 脏语法不抛异常：解析器对未知行降级容忍并给出 warnings

## 主线 B · 产物深度（G9/G5）
- [x] 表格加权打分纯函数：数值/等级词/星级解析、min-max 归一、成本列方向翻转、权重与排除列、推荐结论（table-scoring.check 9/9）
- [x] 时间线自然排序纯函数：三级排序键覆盖 Day/D1/第 N 天/中文数字/钟点/时段词/周/星期/日期；不可解析置后保序（timeline-sort.check 9/9）
- [x] 追问建议：每形态 3 条（2 深化 + 1 跨形态带 formHint），浮窗 chips 点击即发送（followup-suggest.check 4/4）
- [x] 表格行内编辑：点击编辑 / Enter / 失焦提交 / Esc 还原，Markdown 按编辑后内容重导出（tsc）

## 主线 C · 产物可携带（G6/G4）
- [x] Markdown 下载：五形态构建（flowchart 输出 Mermaid 代码块）、文件名时间戳、非浏览器环境守卫、三渲染器入口（download-artifact.check 7/7）
- [x] 会话内版本栈：push 复位 cursor、上限 20、边界夹紧；浮窗上一版/下一版回放不重复入栈（history-stack.check 5/5）
- [x] 本地草稿箱：localStorage 最近 20 条、损坏容错、拒存非法配对、配额超限静默（artifact-drafts.check 7/7）
- [x] 草稿箱浮窗集成：generate 自动落盘、「历史产物」Modal 回放/复制/下载/删除/清空（tsc 0）

## 主线 D · Agent 智能深化（G7/G8/G10-安全）
- [x] artifact 模板短路：四形态内置模板（会议待办/技术选型/三天两晚/读书导图）命中零 LLM 秒回，result 带 artifactKind 与对应 payload（graph.template-shortcut.spec 第 ① 组）
- [x] 模板未命中/定制词 → 继续走 LLM，失败不阻塞主链路（同 spec ②③）
- [x] flowchart 模板短路回归：result 不含 artifactKind 字段、零 LLM 调用（同 spec ④）
- [x] 跨形态不误命中：checklist 关键词在 flowchart 库不命中，反之亦然（同 spec 纯逻辑组）
- [x] FORM_ROUTE 观测埋点：meta 含 kind/source/llmAttempted；header `artifactKind` 落库（graph.artifact.spec ⑥ 2 用例）
- [x] 会话形态偏好：≥2 次且严格最多才采信、不覆盖 formHint、不覆盖规则、并列/阈值不足忽略（form.router.spec 5 用例）
- [x] 会话台账：成功 generate 后累计、下次 createThread 传入快照、跨日清空、上限清理（graph.artifact.spec service 用例）
- [x] 注入对抗加固：四形态提示词均含数据边界与拒绝条款、anchor 全形态生效且只追加、reject/strip 行为一致、formHint 非法值双链路 400（artifact-injection-hardening.spec 4/4）

## 主线 E · 场景与增长（G2/G7）
- [x] 场景工厂 +4：/s/comparison、/s/checklist、/s/travel-plan、/s/reading-map，builder 纯函数 + formHint 配对（multi-artifact-scenarios.check 16/16）
- [x] 场景注册零路由改动：registry 驱动，既有 9 场景不带 formHint（同 check 注册闭环组）
- [x] 模板中心多形态：后端 20 条（含「多形态」分类 4 条带 formHint）、前端分类 chips 与 `&form=` 跳转、类型镜像一致（template.service.spec 8/8 + tsc）
- [x] `/trial?form=` 透传：非法值忽略、合法五值直达浮窗 formHint（tsc）
- [x] 试用页空态引导：四形态示例 chips、画布非空自动隐藏、同页换 q 自动首发且 busy 不丢请求（tsc）

## 回归与文档
- [x] 后端 jest 全量全绿：**42 套件 / 417 用例**（基线 40 套件 395 用例，0 回归 + 新增 22 用例）
- [x] 前端全部 `__checks__` 脚本全绿：**24 个**（基线 14 个；本批次新增 10 个，既有脚本继续通过）
- [x] 前端 `npx tsc --noEmit` 0 错误；`npm run build`（vite）通过
- [x] 后端 `npx tsc --noEmit` 0 错误
- [x] tasks.md / checklist.md 建立并逐项勾选
- [x] `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md` 追加本批次记录
- [x] `docs/tech/artifact.md` 增补本批次新能力
- [x] `docs/deployment/语图项目部署运维手册.md` 补 `ai_trace.artifact_kind` 列 DDL（生产 synchronize=false 需手工执行）

## 兼容性红线
- [x] `artifactKind` 缺省 = flowchart；旧响应/旧前端/旧分享页零影响（graph.artifact.spec ④ 持续锁定）
- [x] flowchart 链路 result 不带 artifactKind 字段；上下文回退 SYSTEM_PROMPT
- [x] template_match flowchart 既有模板（请假审批/费用报销）不回归
- [x] 会话偏好绝不覆盖 formHint
- [x] 前端类型镜像不 import 后端文件
