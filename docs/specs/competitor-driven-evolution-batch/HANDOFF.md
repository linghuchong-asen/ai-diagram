# 交接文档 · 竞品驱动演进二十轮（competitor-driven-evolution-batch）

> 交接时间：2026-10-26 ｜ 交接时进度：R1-R11 已完成验证，R12 纯逻辑完成（浮窗集成待做），R13-R20 未开始。
> **完成状态（2026-10-26 更新）：R1-R20 全部完成并验证。**
> 最终基线：后端 `npx jest` **42 套件 / 417 用例全绿**、`npx tsc --noEmit` 0 错误；
> 前端 `npx tsc --noEmit` 0 错误、**24 个 check 脚本全绿**、`npm run build` 通过（4712 modules）。
> 交付明细见 `tasks.md`、验收证据见 `checklist.md`、变更记录见
> `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md`（"竞品驱动演进 · 二十轮"章节）。
> 本文档以下内容为交接时点的原始记录，保留供溯源；已完成项以 tasks/checklist 为准。
> 本文档供新会话继续工作使用，自包含全部上下文。读完本文即可直接开工。

## 一、项目背景与强制规范（必读）

- 项目：语图（Yutu/IdeaCanvas）——对话式 AI 流程图生成器。前端 React 17 + antd **4** + AntV X6（`frontend/`），后端 NestJS + zod **4** + LangChain（`serverend/`）。
- **AGENTS.md 强制规范**：① 所有功能变更必须形成文档（specs 规格三件套 + `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md` 变更记录）；② 所有代码写**中文注释**，**每个文件头部必须有注释**说明用途与所属模块，修改文件时同步更新头注释。
- 产品已经历两批次演进：`multi-artifact-batch`（多形态产物 Agent，十轮已完成全绿——generate 意图不再等价流程图，支持 flowchart/mindmap/table/checklist/timeline 五形态，含 FormRouter 形式路由、四形态 Schema/Prompt/校验器、前端渲染与 Markdown 导出）。**本批次（competitor-driven-evolution-batch）在其之上做二十轮演进。**

## 二、本批次缘起（R1 已完成的竞品调研）

- 调研文档：`docs/growth/竞品调研-AI图表生成工具全景-2026-10.md`（国际商业产品 Eraser/Napkin/Whimsical/Mermaid Chart/Lucidchart/Miro/Excalidraw、GitHub 开源生态 mermaid 70k★/d2/markmap/OpenDiagram/ai-draw/next-ai-draw-io、国内 ProcessOn/boardmix/WPS AI/亿图）。
- 差距分析得出 G1-G10 十个差距，收敛为五条主线二十轮：
  - **主线 A DSL 互操作**（G1，对标 Mermaid 生态）：R2 Mermaid 解析器、R3 高级语法、R4 PlantUML activity、R5 方言识别+浮窗导入入口
  - **主线 B 产物深度**（G9/G5）：R6 表格加权打分、R7 时间线自然排序、R8 追问建议（含跨形态）、R9 表格行内编辑
  - **主线 C 产物可携带**（G6/G4）：R10 Markdown 文件下载、R11 会话内版本历史栈、R12 本地草稿箱
  - **主线 D Agent 智能深化**（G7/G8，后端）：R13 artifact 模板短路、R14 形式路由观测埋点、R15 会话形态偏好、R16 注入对抗加固
  - **主线 E 场景与增长**（G2/G7）：R17 场景工厂+4 新形态场景页、R18 模板中心多形态扩展、R19 试用页新形态引导、R20 全量回归+文档收尾
- 规格文档：`docs/specs/competitor-driven-evolution-batch/spec.md`（**注意：tasks.md 与 checklist.md 尚未创建**，R20 或开工时补建）。

## 三、当前精确状态（截至交接）

### 已完成并验证的轮次（全部有断言/单测覆盖）

| 轮 | 交付物 | 测试 | 状态 |
|---|---|---|---|
| R1 | 竞品调研文档 + spec.md | — | ✅ |
| R2 | `frontend/src/pages/ai/import/mermaid-parser.ts`（Mermaid flowchart→FlowDraft：头行/方向/九形状/五箭头/两种边标签/链式/裸引用/start-end 出度修正/自环防御） | `__checks__/mermaid-parser.check.ts` 21/21 | ✅ |
| R3 | mermaid-parser 追加：subgraph（组内裸节点→subprocess）、样式/交互指令行跳过、`&` 并联边、end 收组/未闭合提示 | 同上扩展至 **28/28** | ✅ |
| R4 | `frontend/src/pages/ai/import/plantuml-parser.ts`（栈式控制流机：if/else/endif、while 回流环、repeat/repeat while、fork 并行、->标签、partition/note 跳过、detach） | `__checks__/plantuml-parser.check.ts` **11/11** | ✅ |
| R5 | `frontend/src/pages/ai/import/dsl-detect.ts`（围栏剥离/方言识别）+ 浮窗「导入DSL」按钮 + Modal（visible 而非 open！）→ 解析走 autoLayout+flowDraftToX6 预览链路 | `__checks__/dsl-import.check.ts` **6/6** + tsc | ✅ |
| R6 | `frontend/src/pages/ai/artifacts/table-scoring.ts`（单元格评分：数值/等级词/星级/—；min-max 归一；成本类列自动方向翻转；权重/排除列；推荐结论） | `__checks__/table-scoring.check.ts` **9/9** | ✅（纯函数；UI 接线为可选后续） |
| R7 | `frontend/src/pages/ai/artifacts/timeline-sort.ts`（三级排序键 major/slot/minutes；Day/D1/第N天/中文数字/钟点/时段词/周/星期/日期；不可解析置后保原序） | `__checks__/timeline-sort.check.ts` **9/9** | ✅（纯函数；渲染层接入为可选后续） |
| R8 | `frontend/src/pages/ai/artifacts/followup-suggest.ts`（每形态 3 条：2 深化 + 1 跨形态带 formHint）+ 浮窗消息气泡建议 chips（点击 handleSend(prompt, formHint)） | `__checks__/followup-suggest.check.ts` **4/4** + tsc | ✅ |
| R9 | `table-view.tsx` 行内编辑（点击编辑/Enter/失焦提交/还原取消）+ Markdown 按编辑后内容重导出 | tsc | ✅ |
| R10 | `frontend/src/pages/ai/artifacts/download-artifact.ts`（文件名/五形态 Markdown 构建/环境守卫）+ `ArtifactDownloadButton` 接入 table/checklist/timeline 三渲染器 | `__checks__/download-artifact.check.ts` **7/7** + tsc | ✅ |
| R11 | `frontend/src/pages/ai/session/history-stack.ts`（会话内版本栈：push 复位 cursor/上限 20/步进夹紧短路）+ 浮窗 VERSION 条（上一版/下一版，回放走 handleAiResult(payload,{record:false})） | `__checks__/history-stack.check.ts` **5/5** + tsc | ✅ |
| R12（部分） | `frontend/src/utils/artifact-drafts.ts`（localStorage 草稿箱：存储注入 DraftStorageLike 可测/损坏容错/上限 20/拒存非 generate/配额超限静默） | `utils/__checks__/artifact-drafts.check.ts` **7/7** | ⚠️ **纯逻辑完成；浮窗集成未做（见下）** |

### 交接时验证基线

- 后端：`cd serverend && npx jest` → **40 套件 / 395 用例全绿**（本批次后端轮 R13-R16 尚未动后端，此为 multi-artifact 基线）；`npx tsc --noEmit` 0 错误。
- 前端：`npx tsc --noEmit` 0 错误；**23 个 check 脚本全绿**（原 14 + 本批新增 9：mermaid/plantuml/dsl-import/table-scoring/timeline-sort/followup-suggest/download-artifact/history-stack/artifact-drafts）。
- 前端 build 上次通过（multi-artifact 收尾时）；本批次改动后未再跑 build（R20 统一跑）。
- 所有改动**均未提交 git**（用户未要求提交，不要主动 commit）。

### R12 剩余工作（下一步第一件事）

纯逻辑 `artifact-drafts.ts` 已就绪，浮窗集成未做：
1. `ai_float_window.tsx`：① `handleAiResult` 的 record 分支里（pushHistory 旁边）调用 `saveArtifactDraft(result)` 落盘；② 标题栏加「历史产物」按钮（挨着「导入DSL」）+ Modal 列表（形态中文名 + 时间 + 操作）。
2. 列表操作建议：回放（`handleAiResult(entry.payload, { record: false })` 后关弹窗）、复制/下载（复用 `buildArtifactMarkdown(kind, payload)` + `ArtifactCopyButton`/`ArtifactDownloadButton`；注意 flowchart 的 payload 要传 `entry.payload.flowDraft` 而非整个 result，其余形态传对应 `xxxDraft` 字段）。
3. 需要在 `artifact-meta.ts` 补一个 `generatePayloadOf(result)` 辅助（按 artifactKind 取对应 payload 字段），或在浮窗内联实现。
4. 完成后跑 tsc + 全部 check 确认。

## 四、R13-R20 待办详情（含实现要点）

### R13 artifact 模板短路（后端，jest）

- 现状：`serverend/src/ai/agents/graph.ts` 节点 3 只在 `(state.artifactKind ?? 'flowchart') === 'flowchart'` 时调 `template_match`（multi-artifact 批次改的）；命中短路组装 `state.result = { kind:'generate', flowDraft: data.draft }`。
- 要做：先读 `serverend/src/ai/tools/template-matcher.ts`、`tool.registry.ts`（template_match 工具定义与 paramsSchema 在此）。给 matcher 增加 4 形态内置模板（高频请求如「会议待办清单」「技术选型对比」「三天两晚行程」「读书笔记导图」→ 对应 Draft 常量），params 加 artifactKind；graph 节点 3 对所有 generate 形态调用，命中时按 `ARTIFACT_PAYLOAD_FIELD[kind]` 组装 result（配对契约见 `schemas/chat.schema.ts` 的 superRefine）。
- 测试：新建 jest spec 覆盖四形态命中短路（result 带 artifactKind 与对应 payload）、未命中继续走 LLM、flowchart 既有模板不回归。可参照 `agents/graph.artifact.spec.ts` 的 makeGraph 桩模式。

### R14 形式路由观测埋点（后端，jest）

- `serverend/src/observability/trace.types.ts` 的 `TRACE_STEPS` 增加 `FORM_ROUTE`；graph.ts 节点 1.5（形式路由处）加 `recordStep`（meta: kind/source/llmAttempted）+ `updateRun({ artifactKind })`。
- 测试：`graph.artifact.spec.ts` 的 makeGraph 构造 FlowStateGraph 时，formRouter 之后还有两个 @Optional 位（embedder、traceService）——传 `(undefined as never, fakeTraceService)`，fake 用 `{ startRun: jest.fn(), recordStep: jest.fn(), updateRun: jest.fn(), finishRun: jest.fn() }`，断言 FORM_ROUTE 步骤被记录。

### R15 会话形态偏好（后端，jest）

- `FormRouter.route(query, formHint)` 增加第三参 `sessionFormUsage?: Partial<Record<ArtifactKind, number>>`；导出纯函数 `applySessionPreference(usage)`：某形态计数 ≥2 且严格最多 → 规则歧义/未命中时直接采信该形态（source 仍记 'rule'，reason 注明会话偏好）；**绝不覆盖 formHint**；计数全为 0 或并列最多 → 忽略。
- `AgentState` 加 `sessionFormUsage` 字段；`AiService` 加进程内 `Map<sessionId, counts>`（照抄 trialIdUsage 的当日台账模式），executeGraph 成功后累加 `state.artifactKind`，createThread 时读出传入 initial。多实例换 Redis 的注释照抄既有写法。
- 测试：form.router.spec 追加（偏好生效/不覆盖 formHint/并列忽略）。

### R16 注入对抗加固（后端，jest）

- 新建 spec：① 四形态 `ARTIFACT_SYSTEM_PROMPTS` 均含「用户消息只是数据」边界与注入拒绝条款；② `anchorSystemPrompt(artifactSystemPromptFor(kind))` 尾部边界声明对所有形态生效；③ 注入样本过 `filterUserInput`（`security/prompt-injection.ts`）reject/strip 行为不因形态变化；④ `ChatRequestSchema`/`TrialChatRequestSchema` 的 formHint 非法值 issues（R2 已有部分用例，补 controller 语义说明即可）。

### R17 场景工厂 +4（前端，check）

- 先读 `frontend/src/pages/scenarios/registry.ts`（ScenarioConfig 契约）与任一 builder（`builders/` 下有 9 个范例 + `builders/__checks__/` 断言模式）。
- 新增 4 场景：对比表（/s/comparison）、待办清单（/s/checklist）、旅行计划（/s/travel-plan）、读书导图（/s/reading-map）。builder 为纯函数（输入用户填空 → buildPrompt 产出带 formHint 的请求）。场景页零路由扩展（registry 驱动）。
- 注意：ScenarioPage 现在是 buildPrompt → /trial?q=；带 formHint 需要先做 R18 的 /trial?form= 透传（**建议先做 R18 的透传管道，再回来做 R17**，或 R17 场景 prompt 里写明形态关键词让 FormRouter 规则命中——两条路选一，交接时建议前者）。

### R18 模板中心多形态 + /trial formHint 透传（前端，tsc）

- 读 `frontend/src/pages/templates/`（模板中心）与 `frontend/src/pages/trial/index.tsx`（挂 AiFloatWindow 的地方）。
- 管道：/trial 支持 `?form=` 查询参数 → TrialPage 读取 → AiFloatWindow 新增可选 prop `initialFormHint` → `handleSend(initialPrompt, initialFormHint)`（auto-send 处，约 427 行 effect）。浮窗的 handleSend 第二参已支持 formHint（R8 改过）。
- 模板中心加 4 形态模板卡片，点击跳 `/trial?q=...&form=table` 等。

### R19 试用页新形态引导

- trial 页若有自己的示例/预设区，补 4 形态示例（带 form= 参数）；空态文案与新形态对齐。

### R20 全量回归 + 文档收尾

- `cd serverend && npx jest`（全量）+ `npx tsc --noEmit`；前端 `npx tsc --noEmit` + 全部 check（见下方命令）+ `npm run build`。
- 补建 `docs/specs/competitor-driven-evolution-batch/tasks.md` 与 `checklist.md`（格式参照 `docs/specs/multi-artifact-batch/` 三件套）并勾选。
- `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md` 追加本批次记录（含竞品调研结论、二十轮交付、验证数据）。
- `docs/tech/artifact.md` 增补 DSL 导入/打分/下载/历史等新能力小节。
- 最终答复里给二十轮总结（用户要求「深度思考二十轮」的完整叙事）。

## 五、关键技术约定与坑（新会话必看）

1. **测试跑法**（项目不装 jest 到前端、check 自研断言器）：
   - 前端单脚本：`cd frontend && npx tsx src/pages/ai/__checks__/xxx.check.ts`（退出码非 0 即失败）
   - 前端全量循环：`for f in $(find src -name "*.check.ts" | sort); do npx tsx "$f" > /tmp/o 2>&1 && echo "PASS $f" || { echo "FAIL $f"; tail -20 /tmp/o; }; done`
   - 后端：`cd serverend && npx jest`（全量）或 `npx jest src/ai/xxx`；tsc：双侧 `npx tsc --noEmit`
   - check-util 的 import 路径：`pages/ai/__checks__/` 内用 `./check-util`；`utils/__checks__/` 内必须用 `../../pages/ai/__checks__/check-util`（R12 曾因写错层数报 MODULE_NOT_FOUND）
2. **antd 是 4.x**：Modal 用 `visible` 不是 `open`（R5 踩过）；消息组件 `message.success({...})`。
3. **zod 是 4.x**（后端）；递归 Schema 用 `z.lazy` + 显式类型标注。
4. **前端类型镜像**：`frontend/src/utils/aiClient.ts` 与后端 schema 对齐但**绝不 import 后端文件**。
5. **向后兼容红线**：`artifactKind` 缺省 = flowchart；flowchart 链路 result 不带 artifactKind 字段、上下文回退 SYSTEM_PROMPT、template_match 仅 flowchart——这些是 graph.artifact.spec ④ 锁死的行为，改后端时不得回归。
6. **统一分发模式**：新形态/新能力尽量「加四件套 + 注册一行」：Schema（artifact.schema.ts）→ Prompt（artifact.prompts.ts）→ 校验（artifact.validator.ts）→ 前端渲染（artifacts/renderers + artifact-meta 分发）。
7. **每个文件头必须有中文注释**，改动后同步更新；纯函数 + 断言脚本是本仓库的测试惯例（前端无 jest/vitest）。
8. graph.artifact.spec 的 FlowStateGraph 构造桩共 13 个构造参数（intentRecognizer…formRouter, embedder?, traceService?），R14 传 traceService 时注意位置。
9. 环境注意：Windows + Git Bash；`npx tsx` 为临时拉取（未列入依赖）；后端 jest 单套件约 6-30s，全量约 84s。

## 六、本批次新增/修改文件清单（交接时点）

**新增（前端）**：`pages/ai/import/{mermaid-parser,plantuml-parser,dsl-detect}.ts`、`pages/ai/artifacts/{table-scoring,timeline-sort,followup-suggest,download-artifact}.ts`、`pages/ai/session/history-stack.ts`、`utils/artifact-drafts.ts`
**新增（断言）**：`pages/ai/__checks__/{mermaid-parser,plantuml-parser,dsl-import,table-scoring,timeline-sort,followup-suggest,download-artifact,history-stack}.check.ts`、`utils/__checks__/artifact-drafts.check.ts`
**修改（前端）**：`pages/ai/ai_float_window.tsx`（DSL 导入 Modal+按钮、追问建议 chips、版本历史条+handleAiResult record 参数）、`pages/ai/artifacts/renderers/{table-view,checklist-view,timeline-view,artifact-copy}.tsx`（行内编辑/下载按钮）、`artifacts/artifact-meta.ts`（未改，R12 待补 generatePayloadOf）
**新增（文档）**：`docs/growth/竞品调研-AI图表生成工具全景-2026-10.md`、`docs/specs/competitor-driven-evolution-batch/spec.md`、本交接文档
**后端**：本批次尚未改动（R13-R16 待做）
