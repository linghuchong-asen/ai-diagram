# Tasks · 多形态产物 Agent 十轮（multi-artifact-batch）

> 约定：`[BE]` 后端 `serverend/`、`[FE]` 前端 `frontend/`、`[DOC]` 文档。
> 每轮 = 构思 → 写码 → 测试 → 运行；测试命令：后端 `cd serverend && npx jest src/ai`；前端 `cd frontend && npx tsx src/.../__checks__/xxx.check.ts`。

## Round 1 构思（已完成）

- [x] `[DOC]` 头脑风暴（10+ 痛点 → 5 形态映射）+ 架构决策（两级解耦/四件套/形式路由）写入 `spec.md`
- [x] `[DOC]` tasks.md / checklist.md 建立

## Round 2 产物 Schema 体系 `[BE]`

- [x] 2.1 新建 `src/ai/schemas/artifact.schema.ts`：`ARTIFACT_KINDS` 枚举 + MindMapDraft/TableDraft/ChecklistDraft/TimelineDraft + `ArtifactPayload` 判别联合 + `GenerateArtifactResult`（generate 分支扩展，flowchart 向后兼容）
- [x] 2.2 chat.schema.ts 的 `GenerateResultSchema` 扩展 `artifactKind` 与四种 payload（全部 optional，旧响应仍合法）；`ChatRequestSchema`/`TrialChatRequestSchema` 增加 `formHint` 白名单枚举
- [x] 2.3 新建 `artifact.schema.spec.ts`：合法/非法样例、边界（深度/行数/空单元格）、兼容性（无 artifactKind 仍 parse 通过）

## Round 3 形式路由器 `[BE]`

- [x] 3.1 新建 `src/ai/form/form.router.ts`：规则路由（关键词表：对比/表格→table、清单/待办/检查→checklist、行程/排期/时间线→timeline、脑暴/导图/大纲→mindmap）+ formHint 直通 + LLM 兜底分类（small 模型，复用意图分层模式）+ 默认 flowchart
- [x] 3.2 新建 `form.router.spec.ts`：规则命中、formHint 优先、LLM 兜底、LLM 不可用降级、非法输出丢弃

## Round 4 形态 Prompt `[BE]`

- [x] 4.1 新建 `src/ai/prompts/artifact.prompts.ts`：`ARTIFACT_SYSTEM_PROMPTS`（每形态 JSON 契约与生成要点）+ `buildArtifactGeneratePrompt(kind)` 分发
- [x] 4.2 新建 `artifact.prompts.spec.ts`：四形态 prompt 含契约关键词、thinking 标签约定、分发正确性

## Round 5 形态校验器 `[BE]`

- [x] 5.1 新建 `src/ai/reflection/artifact.validator.ts`：`validateArtifact(kind, data)` 结构校验（mindmap 根/深度/节点数；table 列行/列齐整；checklist 组/项；timeline 事件数/时间字段），输出 `ReflectionIssue[]`
- [x] 5.2 evaluator.ts 的 `ReflectionSubject` 扩展 artifact 分支（复用 blocking/warning 分级）
- [x] 5.3 新建 `artifact.validator.spec.ts`：各形态合法/非法/边界

## Round 6 状态图接入 `[BE]`

- [x] 6.1 `agents/state.ts`：AgentState 增加 `artifactKind`/`formHint`/`artifact`（解析后产物）字段
- [x] 6.2 `agents/graph.ts`：generate 分支按 artifactKind 选择 prompt（callLlm）与解析校验（parseArtifactOutput + validateArtifact）；反思/Rewriter 循环对 artifact 复用（修正提示词带形态校验要点）；result 组装带 artifactKind 与对应 payload
- [x] 6.3 `ai.service.ts`：ChatInitDto 透传 formHint；`buildAcceptedResult` 还原 artifact 候选
- [x] 6.4 jest 全量 `src/ai` 回归通过

## Round 7 前端镜像 + 纯逻辑 `[FE]`

- [x] 7.1 `utils/aiClient.ts`：镜像 ArtifactKind/MindMapDraft/TableDraft/ChecklistDraft/TimelineDraft；GenerateResult 增加 artifactKind 与四种 payload；ChatRequest 增加 formHint
- [x] 7.2 新建 `pages/ai/artifacts/` 纯逻辑层：`mindmap-layout.ts`（树 → 坐标/连线，纯函数）、`artifact-markdown.ts`（四形态 → Markdown 文本，复制用）、`artifact-normalize.ts`（脏数据归一化）
- [x] 7.3 新建 `__checks__/artifact.check.ts`：布局无重叠/连线父子闭合、Markdown 结构、归一化降级路径

## Round 8 渲染器 + 浮窗集成 `[FE]`

- [x] 8.1 渲染组件（`pages/ai/artifacts/`）：`renderers/table-view.tsx`（自绘深色表格 + 结论条）、`renderers/checklist-view.tsx`（可交互勾选 + owner/due 标签）、`renderers/timeline-view.tsx`（纵向时间轴）、`renderers/artifact-copy.tsx`（复制 Markdown）、`renderers/artifact-bubble.tsx`（消息流分发）；mindmap 不新做预览组件——经 `mindmap-layout` 转 process 节点 FlowDraft 复用既有 `X6FlowPreview` + 应用链路
- [x] 8.2 `ai_float_window.tsx`：`handleAiResult` 按 artifactKind 分发；预览区/消息流分区渲染；快捷 chips 增加 4 形态示例（带 formHint）
- [x] 8.3 前端 tsc 0 错误；既有 check 全绿

## Round 9 全量回归

- [x] 9.1 后端 jest 全量（全部套件）通过
- [x] 9.2 前端全部 `__checks__` 脚本通过
- [x] 9.3 前端 `npm run build`（tsc + vite）通过；后端 tsc 0 错误

## Round 10 文档收尾

- [x] 10.1 checklist.md 全项勾选 + 验收证据
- [x] 10.2 `align-yutu-doc-and-code/code-iteration-changelog.md` 追加本批次十轮记录
- [x] 10.3 `docs/tech/` 增补多形态产物架构说明；接口变更（formHint/artifactKind）同步
