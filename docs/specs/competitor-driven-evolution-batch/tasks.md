# Tasks · 竞品驱动演进二十轮（competitor-driven-evolution-batch）

> 约定：`[BE]` 后端 `serverend/`、`[FE]` 前端 `frontend/`、`[DOC]` 文档。
> 每轮 = 构思 → 写码 → 测试 → 运行；测试命令：
> 后端 `cd serverend && npx jest src/ai`；前端 `cd frontend && npx tsx src/.../__checks__/xxx.check.ts`。
> 本文件由 R20 收尾时补建（R1-R19 交付均已在交接文档与代码中落定，此处按实际交付回填）。

## Round 1 竞品调研 + 规格 `[DOC]`

- [x] 1.1 `docs/growth/竞品调研-AI图表生成工具全景-2026-10.md`：国际商业产品（Eraser/Napkin/Whimsical/Mermaid Chart/Lucidchart/Miro/Excalidraw）+ GitHub 开源生态（mermaid 70k★/d2/markmap/OpenDiagram/ai-draw/next-ai-draw-io）+ 国内（ProcessOn/boardmix/WPS AI/亿图），差距分析 G1-G10
- [x] 1.2 `docs/specs/competitor-driven-evolution-batch/spec.md`：五条主线 × 二十轮规划
- [x] 1.3 tasks.md / checklist.md（R20 回填）

## Round 2 Mermaid 流程图解析器 `[FE]`

- [x] 2.1 `pages/ai/import/mermaid-parser.ts`：头行/方向/graph|flowchart、九种形状、五种箭头、两种边标签、链式声明、裸引用补节点、start-end 出度修正、自环防御
- [x] 2.2 `__checks__/mermaid-parser.check.ts` 21 用例全绿

## Round 3 Mermaid 高级语法 `[FE]`

- [x] 3.1 subgraph（组内裸节点 → subprocess 语义）、样式/交互指令行跳过、`&` 并联边、end 收组与未闭合提示
- [x] 3.2 同上 check 扩展至 **28/28**

## Round 4 PlantUML activity 解析器 `[FE]`

- [x] 4.1 `pages/ai/import/plantuml-parser.ts`：栈式控制流机——if/else/endif、while 回流环、repeat/repeat while、fork 并行、`-> 标签`、partition/note 跳过、detach
- [x] 4.2 `__checks__/plantuml-parser.check.ts` **11/11**

## Round 5 DSL 导入接线 `[FE]`

- [x] 5.1 `pages/ai/import/dsl-detect.ts`：围栏剥离 + 方言识别（Mermaid/PlantUML）
- [x] 5.2 浮窗标题栏「导入DSL」按钮 + Modal（antd 4 用 `visible`）→ 解析 → autoLayout + flowDraftToX6 预览链路（确认才写画布）
- [x] 5.3 `__checks__/dsl-import.check.ts` **6/6** + tsc 0

## Round 6 表格加权打分 `[FE]`

- [x] 6.1 `pages/ai/artifacts/table-scoring.ts`：单元格评分（数值/等级词/星级/「—」）、min-max 归一、成本类列自动方向翻转、权重/排除列、推荐结论
- [x] 6.2 `__checks__/table-scoring.check.ts` **9/9**

## Round 7 时间线自然排序 `[FE]`

- [x] 7.1 `pages/ai/artifacts/timeline-sort.ts`：三级排序键 major/slot/minutes；Day/D1/第 N 天/中文数字/钟点/时段词/周/星期/日期；不可解析置后且保持原序
- [x] 7.2 `__checks__/timeline-sort.check.ts` **9/9**

## Round 8 追问建议 `[FE]`

- [x] 8.1 `pages/ai/artifacts/followup-suggest.ts`：每形态 3 条（2 深化 + 1 跨形态带 formHint）
- [x] 8.2 浮窗消息气泡建议 chips（点击 `handleSend(prompt, formHint)`）
- [x] 8.3 `__checks__/followup-suggest.check.ts` **4/4** + tsc 0

## Round 9 表格行内编辑 `[FE]`

- [x] 9.1 `renderers/table-view.tsx`：点击编辑 / Enter 提交 / 失焦提交 / Esc 还原
- [x] 9.2 Markdown 按编辑后内容重导出（复制/下载均消费 editedDraft）
- [x] 9.3 tsc 0

## Round 10 Markdown 文件下载 `[FE]`

- [x] 10.1 `artifacts/download-artifact.ts`：文件名（语图-形态-时间戳.md）、五形态 Markdown 构建（flowchart 输出 Mermaid 代码块）、非浏览器环境守卫
- [x] 10.2 `renderers/artifact-copy.tsx` 增加 `ArtifactDownloadButton`，接入 table/checklist/timeline 三渲染器
- [x] 10.3 `__checks__/download-artifact.check.ts` **7/7** + tsc 0

## Round 11 会话内版本历史 `[FE]`

- [x] 11.1 `pages/ai/session/history-stack.ts`：push 复位 cursor、上限 20、步进夹紧短路
- [x] 11.2 浮窗 VERSION 条（上一版/下一版；回放走 `handleAiResult(payload,{record:false})`，不重复入栈）
- [x] 11.3 `__checks__/history-stack.check.ts` **5/5** + tsc 0

## Round 12 本地草稿箱 `[FE]`

- [x] 12.1 `utils/artifact-drafts.ts`：localStorage 最近 20 条；存储注入 `DraftStorageLike` 可测；损坏容错；拒存非 generate/形态-payload 不配对；配额超限静默
- [x] 12.2 `utils/__checks__/artifact-drafts.check.ts` **7/7**
- [x] 12.3 浮窗集成：`handleAiResult` record 分支 `saveArtifactDraft(result)` 落盘；标题栏「历史产物」Modal（形态中文名 + 时间 + 回放/复制/下载/删除/清空）
- [x] 12.4 `artifact-meta.ts` 增加 `generatePayloadOf(result)`（按 artifactKind 取 Draft 本体）
- [x] 12.5 tsc 0 + 草稿箱 check 复跑通过

## Round 13 artifact 模板短路（四形态）`[BE]`

- [x] 13.1 `tools/template-matcher.ts`：新增四形态模板库（会议待办清单/技术选型对比/三天两晚行程/读书笔记导图），`match(query, artifactKind)` 按形态分库，定制词仍跳过
- [x] 13.2 `tools/tool.registry.ts`：`TemplateMatchParamsSchema` 加 `artifactKind`（复用白名单枚举）；run 分形态返回 draft / artifact
- [x] 13.3 `agents/graph.ts` 节点 3：generate 全形态调用 template_match；新形态命中按 `ARTIFACT_PAYLOAD_FIELD[kind]` 组装 result（flowchart 兼容红线不变）
- [x] 13.4 `agents/graph.template-shortcut.spec.ts`：四形态命中零 LLM / 未命中走 LLM / 定制词跳过 / flowchart 回归 / 工具参数契约，**8 用例**全绿

## Round 14 形式路由观测埋点 `[BE]`

- [x] 14.1 `observability/trace.types.ts`：`TRACE_STEPS.FORM_ROUTE = 'form.route'`
- [x] 14.2 `observability/entities/trace.entity.ts`：新增 nullable 列 `artifact_kind`（varchar 16；生产需 DDL，见部署文档）
- [x] 14.3 `trace.service.ts`：`updateRun` patch 增加 `artifactKind`
- [x] 14.4 `graph.ts` 节点 1.5：记录 FORM_ROUTE 步骤（meta: kind/source/llmAttempted）+ `updateRun({ artifactKind })`；恢复执行预置形态时跳过埋点
- [x] 14.5 `graph.artifact.spec.ts`：埋点字段与 updateRun 断言 + 恢复执行不重复记录，**2 用例**全绿

## Round 15 会话形态偏好 `[BE]`

- [x] 15.1 `form/form.router.ts`：导出 `applySessionPreference(usage)`（≥2 次且严格最多才采信）与 `SESSION_PREFERENCE_MIN_COUNT`；`route` 第三参 `sessionFormUsage`，规则歧义/未命中时采信偏好（source='rule'，reason 注明）
- [x] 15.2 `agents/state.ts`：`AgentState.sessionFormUsage` + createInitialState 透传
- [x] 15.3 `ai.service.ts`：进程内 `sessionFormLedger`（当日 TTL，照抄 trial 台账模式）；createThread 读出快照传入、executeGraph 成功后累计（返回拷贝防污染）
- [x] 15.4 `form.router.spec.ts` 追加 5 用例（偏好生效/不覆盖 formHint/不覆盖规则/并列与阈值忽略/纯函数）+ `graph.artifact.spec.ts` 台账用例，全绿

## Round 16 注入对抗加固 `[BE]`

- [x] 16.1 新建 `security/artifact-injection-hardening.spec.ts` **4 用例**：四形态提示词边界条款自检 / anchorSystemPrompt 全形态生效且只追加 / 注入样本 reject-strip 行为与正常请求放行 / formHint 非法值双链路 Zod 拒绝
- [x] 16.2 后端全量回归 42 套件 417 用例全绿

## Round 17 场景工厂 +4 `[FE]`

- [x] 17.1 `ScenarioConfig` 增加可选 `formHint`；ScenarioPage 提交拼 `&form=`（Round 18 管道消费）
- [x] 17.2 新增 builder：`comparison.ts`（/s/comparison，table）、`todo-checklist.ts`（/s/checklist，checklist）、`travel-plan.ts`（/s/travel-plan，timeline）、`reading-map.ts`（/s/reading-map，mindmap），均为纯函数
- [x] 17.3 registry 注册四行（零路由改动）
- [x] 17.4 `builders/__checks__/multi-artifact-scenarios.check.ts` **16/16** + tsc 0

## Round 18 模板中心多形态 + /trial formHint 透传 `[BE+FE]`

- [x] 18.1 后端 `template.service.ts`：`TemplateCategory` 加「多形态」；`FlowTemplate` 加可选 `formHint`；新增 4 条形态模板（16 → 20）；spec 更新为 8 用例（总数/新条目/formHint 与分类配对/五分类覆盖）
- [x] 18.2 前端 `templates/server.ts` 镜像类型 + `templates/index.tsx` 分类 chips 加「多形态」、跳转拼 `&form=`
- [x] 18.3 `/trial` 读取 `?form=` → `AiFloatWindow.initialFormHint` → 自动首发 `handleSend(prompt, formHint)`
- [x] 18.4 前端 tsc 0 + 模板服务 8/8

## Round 19 试用页新形态引导 `[FE]`

- [x] 19.1 `/trial` 画布空态居中引导（标题 + 五形态说明 + 四形态示例 chips），点击拼 `?q=&form=` 同页直达
- [x] 19.2 空画布监听（`cell:added/removed`）——生成应用后自动隐藏引导
- [x] 19.3 浮窗自动首发语义扩展：同一 prompt+form 不重发、新组合才发、busy 时挂起待空闲补发
- [x] 19.4 tsc 0

## Round 20 全量回归 + 文档收尾

- [x] 20.1 后端 `npx tsc --noEmit` 0 错误；`npx jest` **42 套件 / 417 用例全绿**
- [x] 20.2 前端 `npx tsc --noEmit` 0 错误；**24 个 check 脚本全绿**；`npm run build` 通过
- [x] 20.3 tasks.md / checklist.md 补建并勾选
- [x] 20.4 `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md` 追加本批次记录
- [x] 20.5 `docs/tech/artifact.md` 增补 DSL 导入 / 打分 / 排序 / 追问 / 下载 / 版本栈 / 草稿箱 / 模板短路 / 观测 / 偏好小节
- [x] 20.6 `docs/deployment/` 补 `ai_trace.artifact_kind` 列 DDL 说明
