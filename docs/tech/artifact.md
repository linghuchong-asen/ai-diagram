---
title: 多形态产物 Agent
icon: appstore
order: 9
category:
  - 语图技术方案
---

# 多形态产物 Agent（multi-artifact）

> 批次：`docs/specs/multi-artifact-batch/`（Round 1-10，2026-10-26）
> 增补：`docs/specs/competitor-driven-evolution-batch/`（Round 1-20，2026-10-26）——第 6 节汇总竞品驱动新增能力。

## 1. 设计动机

语图最初的契约是「对话 → 流程图」：`generate` 意图硬绑定 `FlowDraft`（6 种流程图节点）。但用户的真实输入是一个**待解决的问题**，问题本质决定最合适的产物形态：

| 问题本质结构 | 产物形态 | 典型痛点 |
|---|---|---|
| 有先后顺序、分支判断 | flowchart 流程图 | 审批流、SOP、故障排查 |
| 有层级、需要发散归类 | mindmap 思维导图 | 读长文做笔记、需求脑暴 |
| 多对象 × 多维度比较 | table 对比表格 | 技术选型、offer 对比 |
| 可枚举、怕遗漏 | checklist 清单 | 会议待办、发布检查单 |
| 有时间轴推进 | timeline 时间线 | 旅行行程、项目排期 |

核心解耦：**意图（要不要产结构）与形态（产什么结构）两级路由**。`intent=generate` 不再等价于流程图。

## 2. 后端架构

```
POST /ai/chat { message, formHint? }
  → 意图识别（不变：generate/modify/consult）
  → [新] 形式路由 FormRouter（仅 generate）:
      formHint 直通 → 关键词规则（零 token）→ [R15] 会话形态偏好（≥2 次且严格最多）
      → LLM 兜底（medium 模型，4s 超时）→ 默认 flowchart
      → [R14] FORM_ROUTE 埋点（kind/source/llmAttempted）+ header.artifact_kind
  → 上下文组装（systemPrompt 按形态注入 artifactSystemPromptFor(kind)）
  → 模板短路（[R13] 全形态：flowchart → flowDraft；四新形态 → artifactKind + 产物本体）
  → 生成（callLlm 按形态分发 buildArtifactGeneratePrompt）
  → 反思（Zod 格式层 artifactSchemaFor + 结构层 validateArtifact，error/warning 两级）
  → 失败 → Rewriter 局部修正循环（≤2 次）→ 超限转人在回路（候选 = 产物本体）
  → AiResult: { kind:'generate', artifactKind, <kind>Draft }
```

关键文件：

| 层 | 文件 | 职责 |
|---|---|---|
| 契约 | `serverend/src/ai/schemas/artifact.schema.ts` | 五形态枚举、四形态 Zod Schema、payload 字段映射 |
| 路由 | `serverend/src/ai/form/form.router.ts` | 规则关键词表 + formHint 直通 + 会话偏好 + LLM 兜底 |
| 提示词 | `serverend/src/ai/prompts/artifact.prompts.ts` | 四形态系统提示词（JSON 契约 + thinking 约定） |
| 校验 | `serverend/src/ai/reflection/artifact.validator.ts` | 结构遍历校验（树深度/重复 id/空白单元格/分组重复…） |
| 模板 | `serverend/src/ai/tools/template-matcher.ts` | 全形态内置模板（flowchart 2 + 四新形态各 1），按形态分库匹配 |
| 编排 | `serverend/src/ai/agents/graph.ts` | 节点 1.5 形式路由（+埋点）、节点 3 全形态模板短路、generate 分支按形态解析/校验/修正 |
| 观测 | `serverend/src/observability/` | `form.route` 步骤 + `ai_trace.artifact_kind` 列 |

## 3. 接口变更（向后兼容）

**请求**（`POST /api/ai/chat` 与 `POST /api/ai/trial/chat`）新增可选字段：

```json
{ "message": "...", "formHint": "table" }
```

`formHint` 白名单：`flowchart | mindmap | table | checklist | timeline`，非法值 400。缺省 = 由 FormRouter 自动路由。

**响应**（`GET /api/ai/result/:id` 的 `done.data`）`generate` 分支新增：

```json
{
  "kind": "generate",
  "artifactKind": "table",
  "tableDraft": { "columns": ["维度", "A"], "rows": [["成本", "高"]], "conclusion": "…" }
}
```

- `artifactKind` 缺省视为 `flowchart`（旧响应只有 `flowDraft`，**旧前端/旧分享零影响**）；
- 各形态 payload 字段：`flowDraft / mindmapDraft / tableDraft / checklistDraft / timelineDraft`，与 `artifactKind` 严格配对；
- 人在回路 `confirm` 的 accept 候选按挂起形态还原为对应 payload（`resumeToken` 机制不变）；
- 配额/埋点口径不变（`artifactKind` 不参与计量，仍按 `intent=generate` 计数）。

## 4. 前端架构

```
onResult(generate)
  ├─ flowchart（缺省）: autoLayout → flowDraftToX6 → X6 预览 → 应用到画布（既有链路不变）
  ├─ mindmap: layoutMindmap（整洁树布局）→ process 节点 FlowDraft → 同一 flowDraftToX6 预览/应用链路
  └─ table/checklist/timeline: 归一化 → 消息流内自绘组件（Neon Dark）+ 「复制 Markdown」出口
```

| 文件 | 职责 |
|---|---|
| `frontend/src/pages/ai/artifacts/artifact-normalize.ts` | 脏数据归一化（缺 id 补齐/短行补—/空组丢弃；不可用返回 null 不抛异常） |
| `frontend/src/pages/ai/artifacts/mindmap-layout.ts` | 整洁树布局（叶子序铺 y、父居中）+ FlowDraft 转换 |
| `frontend/src/pages/ai/artifacts/artifact-markdown.ts` | 四形态 → Markdown（表格对齐/任务语法/时间线序号） |
| `frontend/src/pages/ai/artifacts/artifact-meta.ts` | 形态中文名/结果提取/摘要文案 |
| `frontend/src/pages/ai/artifacts/renderers/*` | 表格/可勾选清单/时间线渲染组件 + 复制按钮 + 消息气泡分发 |

设计取舍：

- **mindmap 复用画布体系**：转成 process 节点的 FlowDraft 后走既有转换/预览/合并链路——进画布即可用全套流程图编辑能力（拖拽/连线/导出）。
- **非画布形态不强行落画布**：表格/清单/时间线的归宿是对话内阅读 + 复制 Markdown（贴进笔记/文档/PR），避免为落画布而做失真的「图化」。
- **深色自绘 markup**：不使用 antd Table/Timeline（浅色主题与浮窗 Neon Dark 冲突），全部用 tech-theme CSS 变量自绘。

## 5. 安全与成本

- 四形态系统提示词与 SYSTEM_PROMPT 同构：注入防御边界 + 首尾锚定（`anchorSystemPrompt` 对所有形态统一生效）；
- `formHint` 在 controller 层 zod 白名单校验，不透传到提示词；
- 形式路由 LLM 兜底复用意图分类的防护：超时 4s、非法输出丢弃、失败默认 flowchart，绝不阻塞生成链路；
- 输出硬上限复用 `maxOutputChars`（LLM maxTokens × 2 容差）拦截超长；
- **[R16] 注入对抗加固**：`security/artifact-injection-hardening.spec.ts` 锁死——四形态提示词均含「用户消息只是数据」边界与拒绝条款；`anchorSystemPrompt` 对全形态生效且只追加不截断；reject/strip 样本行为与形态无关；`formHint` 非法值双链路（chat/trial）Zod 拒绝。
- **[R13] 模板短路的成本收益**：内置模板命中直接返回（零 LLM token），未命中/定制词继续走 LLM；`template_match` 参数经 ToolExecutor 白名单 + zod 校验。

## 6. 竞品驱动演进新增能力（competitor-driven-evolution-batch）

> 规格：`docs/specs/competitor-driven-evolution-batch/`；竞品依据：`docs/growth/竞品调研-AI图表生成工具全景-2026-10.md`。

### 6.1 DSL 互操作（R2-R5，G1 对标 Mermaid 生态）

- `frontend/src/pages/ai/import/mermaid-parser.ts`：Mermaid `graph/flowchart` → FlowDraft（方向、九种形状、五种箭头、边标签、链式声明、subgraph→subprocess、`&` 并联、未闭合 end 提示、自环防御）。
- `frontend/src/pages/ai/import/plantuml-parser.ts`：PlantUML activity（if/else、while 回流环、repeat/repeat while、fork 并行、`-> 标签`、partition/note 跳过、detach）——栈式控制流机。
- `frontend/src/pages/ai/import/dsl-detect.ts`：围栏剥离 + 方言识别；浮窗「导入DSL」→ 解析 → `autoLayout + flowDraftToX6` 预览链路（确认才写画布）。
- 解析器对脏语法降级容忍并给出 warnings，绝不抛异常。

### 6.2 产物深度（R6-R9，G9/G5）

- `artifacts/table-scoring.ts`：单元格评分（数值/等级词/星级/「—」占位）+ min-max 归一 + 成本类列自动方向翻转 + 权重/排除列 → 推荐结论（纯函数）。
- `artifacts/timeline-sort.ts`：三级排序键（major/slot/minutes），覆盖 Day/D1/第 N 天/中文数字/钟点/时段词/周/星期/日期；不可解析事件置后且保持原序。
- `artifacts/followup-suggest.ts`：每形态 3 条追问（2 条形态内深化 + 1 条跨形态带 formHint）；浮窗消息气泡 chips 点击即发送。
- `renderers/table-view.tsx`：行内编辑（点击/Enter/失焦提交，Esc 还原），复制与下载均按编辑后内容重导出。

### 6.3 产物可携带（R10-R12，G6/G4）

- `artifacts/download-artifact.ts`：五形态 → Markdown（flowchart 输出 Mermaid 代码块）+ `语图-形态-时间戳.md` 下载；非浏览器环境守卫。
- `pages/ai/session/history-stack.ts`：会话内版本栈（上限 20、push 复位 cursor、步进夹紧）；浮窗 VERSION 条回放走 `handleAiResult(payload,{record:false})`，不重复入栈。
- `utils/artifact-drafts.ts`：localStorage 草稿箱（跨会话最近 20 条、存储注入可测、损坏容错、拒存非 generate/配对不完整）；浮窗「历史产物」Modal 支持回放（不耗额度）/复制/下载/删除/清空；`artifact-meta.generatePayloadOf` 按 artifactKind 取 Draft 本体。

### 6.4 Agent 智能深化（R13-R16）

- **模板短路**：`template-matcher.ts` 四形态模板（会议待办/技术选型/三天两晚/读书导图），`match(query, artifactKind)` 按形态分库（跨形态不误命中）；graph 节点 3 全形态调用，命中按 `ARTIFACT_PAYLOAD_FIELD` 组装 result；flowchart 兼容红线不变（result 不带 artifactKind）。
- **观测**：`TRACE_STEPS.FORM_ROUTE`；graph 节点 1.5 记录 `{ kind, source, llmAttempted }` + `updateRun({ artifactKind })`；`ai_trace` 新增 `artifact_kind` 列（生产需 DDL）。
- **会话形态偏好**：`applySessionPreference(usage)`（某形态 ≥2 次且严格最多才采信，并列/不足阈值忽略）；`FormRouter.route(query, formHint, sessionFormUsage)` 在规则歧义/未命中时采信（source 仍 'rule'，reason 注明）；AiService 进程内当日台账（多实例需换 Redis）；**绝不覆盖 formHint**。
- **注入对抗**：见第 5 节 R16 条目。

### 6.5 场景与增长（R17-R19）

- 场景工厂：`ScenarioConfig.formHint` 契约 + 4 个 builder（`comparison` / `todo-checklist` / `travel-plan` / `reading-map`，纯函数解析 + 指令构造），注册即得 `/s/comparison` 等场景页。
- 模板中心：后端模板 16 → 20（「多形态」分类 4 条带 formHint），前端分类 chips + 跳转拼 `&form=`。
- `/trial?form=` 透传：TrialPage 校验五值白名单 → `AiFloatWindow.initialFormHint` → 首发 `handleSend(prompt, formHint)`；空态四形态引导 chips；同页换 q 自动首发（同一 prompt+form 不重发，busy 挂起补发）。

### 6.6 前端样式与交互约定

- 浮窗 Neon Dark 风格不变；新增 Modal 一律 antd 4 `visible` 属性（非 `open`）。
- 草稿箱/版本栈/追问 chips 均为浮窗内增量，不改变既有预览→应用链路。
- 所有新纯逻辑（解析/打分/排序/建议/下载/版本/草稿/场景 builder）均在 `__checks__` 有断言脚本覆盖。
