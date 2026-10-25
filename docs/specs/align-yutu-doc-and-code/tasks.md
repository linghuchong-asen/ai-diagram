# Tasks

> 约定：`[FE]` 前端 `frontend/`、`[BE]` 后端 `serverend/`、`[DOC]` 语图文档 `projectDemo/docs/ai-tech/`、`[RPT]` 报告交付物。
> 阶段一/二内标注「可并行」的任务分派给不同 Sub-Agent 同时执行；未标注的按序执行。

## 阶段一：补齐缺失代码

- [x] Task 1 `[FE]`: 建立 FlowDraft→X6 转换层（文档 `frontend/index.md` 的 NODE_TYPE_CONFIG / PORT_GROUPS / toX6Node 规则）
  - [x] 1.1 新建 `src/pages/ai/transform/node-type-config.ts`：6 种语义节点的 shape/尺寸/attrs（start·end 椭圆 120×50、process 圆角矩形 140×50、decision 菱形 `refPoints:'0,40 70,0 140,40 70,80'`、io 平行四边形 `refPoints:'20,0 140,0 120,50 0,50'`、subprocess 双线框），含未知 type → process 降级
  - [x] 1.2 新建 `port-groups.ts`：四向端口组定义 + 端口方向约定（start 仅 bottom、end 仅 top，其余四向）
  - [x] 1.3 新建 `to-x6.ts`：`toX6Node/toX6Edge/flowDraftToX6/x6ToFlowDraft`，纯函数、无副作用，输出 X6 cells 结构
  - [x] 1.4 单测覆盖：6 类型映射、端口方向、降级路径、空 nodes/edges 边界（`__checks__/transform.check.ts` 22/22 通过）

- [x] Task 2 `[FE]`: 实现程序化布局与碰撞规避（替代未安装的 @antv/layout）
  - [x] 2.1 新建 `src/pages/ai/layout/auto-layout.ts`：最长路径拓扑分层 + 重心排序，环图 guard（迭代上限 n²+1）
  - [x] 2.2 新建 `collision.ts`：矩形包围盒碰撞检测 + 间距约束 + `resolveCollisions`
  - [x] 2.3 新建 `place-new-node.ts`：相连节点质心定位 → 碰撞检测 → 先下后右固定步进偏移（dx=180/dy=100）
  - [x] 2.4 单测覆盖：密集区域插入不重叠、环图不死循环、既有节点坐标零变动（`__checks__/layout.check.ts` 33/33 通过）

- [x] Task 3 `[FE]`: 实现增量修改四级降级匹配与选择性应用（文档 `index.md` 难点解答）
  - [x] 3.1 新建 `src/pages/ai/match/match-level.ts`：`MatchLevel` 四级 + 置信度表 + `snapshotFromGraphJSON`
  - [x] 3.2 新建 `matcher.ts`：L1 id → L2 label+type（归一化）→ L3 拓扑签名 → L4 边校验兜底，未命中返回 null 不猜测
  - [x] 3.3 新建 `apply-operations.ts`：7 种 op 全覆盖，产出 ApplyPlan + 残差清单（skipReason 四类归因），纯函数不改入参
  - [x] 3.4 选择性应用 UI：`ApplyPlanPanel.tsx`（antd 4 受控组件，勾选/歧义裁决/残差 Alert）
  - [x] 3.5 单测覆盖：漏写 id 不误删、四级各命中路径、全未命中残差、7 种 op 全覆盖（`__checks__/match.check.ts` 30/30 通过）

- [x] Task 4 `[FE]`: 统一 AI 接口客户端与 SSE 协议
  - [x] 4.1 新建 `src/utils/aiClient.ts`（912 行）：`startChat` / `connectThink` / `pollResult`（202 + Retry-After clamp 250ms~10s，退避 1s→2s→3s，总超时 120s）/ `confirmChoice` / `runAiSession` 组合函数；Authorization 取自 `localStorage`（与 http.ts 同源）
  - [x] 4.2 删除 `src/utils/sse.ts`（grep 确认 `connectSSE` 零引用），SSE 单一客户端改由 `connectThink` 提供，事件字段严格对齐 `ThinkSseEvent`（thinking|done|error），`delta` vs `token` 冲突消除
  - [x] 4.3 修复 `src/utils/http.ts` catch：新增 `HttpError`（message/status/data/bodySummary）+ `toHttpError()`，成功路径返回结构未动
  - [x] 4.4 三条清理路径（超时 / error 事件 / `abort()`）统一走 `cleanup()`：关 EventSource + 清 `Set<timer>` 全部定时器 + `controller.abort()`，`abort()`/`close()` 幂等；另有 `STREAM_WATCHDOG_MS=2000` 兜底起轮覆盖「done 在订阅前已推送」竞态
  - [x] 4.5 附：核实 ai 四端点均标注 `@SkipInterceptor()`（裸 JSON 不包装），保留 `unwrapEnvelope()` 兜底；`projectSearch` 端点被包装需剥壳；断言脚本 35/35 通过、tsc EXIT=0

- [x] Task 5 `[FE]`: AI 浮窗挂载与人在回路 UI
  - [x] 5.1 `AiFloatWindow` 已挂进 `x6Editor/index.tsx` 组件树（props 传 `graph` 与 `projectId`），路由 `/editor/:projectid/:projectName` 可达
  - [x] 5.2 `handleSend` 补齐三要素：`graph.toJSON() → x6ToFlowDraft → CanvasNodeSummary[]` 作 canvas、sessionId 首个 threadId 后固定、projectId 取路由参数；空画布时 modify 提示改走 generate
  - [x] 5.3 数据链路整体替换为 `runAiSession`：generate 走 autoLayout+flowDraftToX6+只读预览+「应用到画布」（非空画布整体避让）；modify 走 snapshotFromGraphJSON→buildApplyPlan→ModifyPlanModal(ApplyPlanPanel)→applyOperations→残差四类归因展示→快照拼回；「已应用 N 项」硬编码文案已删除
  - [x] 5.4 人在回路确认卡片（reason/issues/candidates 单选/≤500 字补充说明映射 `instruction`/resumeToken 透传），确认前画布零变更，提交后回等待态
  - [x] 5.5 预览改只读 X6 画布（`interacting:false`），删除原内联 SVG FlowPreview 及自研布局死代码（FlowPreview/TYPE_META/extractDraft/summarizeResult 等，规格批准的替换）
  - [x] 5.6 生命周期：卸载/收起 `session.abort()`、发送中禁重复提交、onError 可读信息+重试；断言 ai-flow 17/17 + 既有 85 全绿，tsc EXIT=0

- [x] Task 6 `[FE]`: 编辑器节点体系统一到语义类型（**依赖 Task 1**）
  - [x] 6.1 改造 `components/node_types.tsx` Stencil 面板：image shape + SVG 图片资源 → 6 种语义节点；补齐拖放入画布（复用 `toX6Node()`，`getDragNode/getDropNode` 落点重建真实尺寸节点，`data.origin='canvas'`）
  - [x] 6.2 改造 `ConfigNode/index.tsx`：fill 属性 key 修为 `body/fill`、`node:moved/node:resized` 卸载时 `graph.off`、`changePorts` 死代码移除
  - [x] 6.3 改造 `ConfigEdge/index.tsx`：颜色改读写 `labels[0].attrs.label.fill`（原 `text/fill` selector 不存在完全无效）；`ConfigGrid` 决策为恢复入口（`blank:click → clickType=3` 分支上移到 nowCell 判空前）
  - [x] 6.4 改造 `toolBar.tsx`：快捷键统一进 `useEffect` + `unbindKey` 清理、缩放改 `zoomTo` 绝对值 + `syncScaleLabel()`、`isSave` 收敛为局部 `isSaved`、附带修 `history.on('change')` 泄漏
  - [x] 6.5 改造 `useGraph.tsx`：容器尺寸自适应 + `ResizeObserver`/`resize()`/`dispose()`、小地图删除边屏蔽逻辑、`index.tsx` 重复 `cell:dblclick` 合并为一处

- [x] Task 7 `[BE]`: 意图识别模型兜底落地（可与 Task 1~6 并行）
  - [x] 7.1 新增 `intent.llm-classifier.ts`：规则未命中/ambiguous/多命中时调用 medium 模型 + 启用 `INTENT_SYSTEM_PROMPT`（6s 超时 + try/catch，不抛主链路）
  - [x] 7.2 `IntentClassificationSchema` zod 校验（三意图枚举 + confidence + reason），失败回落规则并记录原因
  - [x] 7.3 `intentSource` 真实区分 `rule`/`llm`，返回值携带 `usage` token 用量

- [x] Task 8 `[BE]`: 工具调用适配层接入主链路
  - [x] 8.1 `graph.ts` generate 意图先经白名单 `template_match`，命中短路、未命中走 LLM
  - [x] 8.2 新建 `tool-executor.ts` 统一出口：白名单 + zod 参数校验 + 结果封顶（数组 top-5 / 字段白名单 / 字符串 2000 / 深度 4）+ 归一化 `ToolResult`
  - [x] 8.3 `tool-retry.ts`：network 指数退避 200/400/800ms ≤3 次；param 回传结构化纠错摘要给模型；耗尽走 `buildToolDegradeMessage` 受控话术
  - [x] 8.4 新建 `error-sanitizer.ts`：密钥/路径/堆栈脱敏，仅 `message_for_llm` 进上下文（含单测）
  - [x] 8.5 `tool-context.store.ts`：`context_id` 有界 Map（LRU + 10min TTL + 上限 200），线程释放联动清理
  - [x] 8.6 `layout.tool` 移出白名单（布局归前端转换层）；`validator.tool` 接真实 GraphValidator 注册为 `validate_graph`

- [x] Task 9 `[BE]`: 反思校验与流式链路收尾（可与 Task 8 并行）
  - [x] 9.1 `graph.validator.ts` 新增 `HAS_CYCLE`（DFS 三色染色），severity=warning 不阻断（审批退回属合法回环）
  - [x] 9.2 Rewriter 局部修正不重走主流程、`maxRetries=2`、超限 `suspendForHumanConfirm` 转人在回路
  - [x] 9.3 generate/modify/reflect/system/fallback prompts 全部接通；compress/optimize/suggest 归属记忆模块，已在 `prompts/index.ts` 注释声明
  - [x] 9.4 `executeGraph` finally 全路径调用 `thinkStream.end()`；新建 `thread-cleaner.service.ts`（5min 间隔 / 30min TTL / `unref()`）
  - [x] 9.5 挂起态接线：`GET /ai/result/:id` 返回 `status:'need_confirm'`，新增 `POST /ai/confirm/:threadId`（accept/retry + resumeToken 防重放）

- [x] Task 10 `[BE]`: 记忆体系与上下文预算
  - [x] 10.1 滚动摘要每 2 轮写入 `conversation_summaries`（LLM 不可用退化规则摘要）；Checkpointer 接口 + 内存/PG 双实现，`CHECKPOINT_STORE` 开关接线 `PgCheckpointSaver`（memory.wiring.ts）
  - [x] 10.2 `EmbeddingProviderFactory`/`EMBEDDING_PROVIDER` token/`LlmMemoryReranker` 注册进 AiModule 并 onModuleInit 接线；双路召回（候选有界 200、JS 余弦）+ RRF top-10 + Reranker top-3 + degraded 降级记录；optimize/suggest 未启用原因已在 prompts/index.ts 注明
  - [x] 10.3 `ForgettingScheduler` 注册为 provider（此前未注册导致 onModuleInit 不触发），定时器 unref 生效；公式 weight=exp(-0.693·days/halfLife) 三档处理
  - [x] 10.4 分段预算 0.4/0.2/0.15/0.1/0.1/0.05、总量卡 80%、超限截断+配额借用（context.builder + token-budget）
  - [x] 10.5 entity-slot 实体保真 + topic-shift 话题切换（graph.ts 已调用 ingest/detectTopicShiftForThread）
  - [x] 10.6 命名空间隔离单测覆盖；修复真实 bug：`executeGraph` 误传 sessionId 给 `profiles.ingestFromConversation` 触发 `assertUserNamespace` 每轮报错 → 改传真实 userId，无 userId 跳过

- [x] Task 11 `[BE]`: 安全、鉴权与配置加固
  - [x] 11.1 `JwtAuthGuard` 支持 `@Public()`（Reflector+SetMetadata）；AiController 类级守卫，think SSE 端点 @Public（threadId=randomUUID 即凭证）；AiModule imports AuthModule；projectManager 守卫启用
  - [x] 11.2 `ProjectEntity` 新增可空 userId 归属列（历史 NULL 放行兼容）；findAll 过滤本人+未归属；findById/update/remove/export 校验归属；editorDocument 三端点校验；统一 403 文案（project-ownership.ts）不泄露存在性
  - [x] 11.3 TokenStore 接口 + PG 默认实现（auth_tokens 表存 sha256 摘要，唯一索引）；登出 `/auth/logout` 接入 + JwtStrategy 每请求查吊销（passReqToCallback）；Redis 实现未做（ioredis 不在依赖，遵守不装包约束）
  - [x] 11.4 CORS `origin:'*'` → 白名单函数（CORS_ORIGINS，默认仅 localhost:5173/3000/127.0.0.1）；JWT secret 强制环境变量（jwt-secret.ts，历史默认值启动报错）；DB_SYNCHRONIZE 开关（显式配置优先，production 默认 false）；grep 未见真实兜底 key（sk- 命中均为测试样本与脱敏注释）
  - [x] 11.5 三级防护：`ai_daily_usage` 原子 upsert（generate/modify 分计，超限 429 AI_QUOTA_EXCEEDED）；会话软上限 80% 在 AiResult 附 notice；调用级 LLM_MAX_OUTPUT_TOKENS（默认 4096）+ 超长按格式问题走 Rewriter 反思重试
  - [x] 11.6 `prompt-injection.ts` reject 级 8 类模式 + strip 级清洗，graph.ts 意图识别前接入（reject 返回受控话术不进模型）；`anchorSystemPrompt` 尾部角色锚定
  - [x] 11.V 验证：tsc 仅剩 1 个基线错误；jest 218 passed（新增 93 全过，失败集合与基线完全相同）；评估脚本 B 档 6 个 e2e 全启用，54/54 通过退出码 0

- [x] Task 12 `[BE]`: 存储检索接线与既有缺陷修复（可与 Task 11 并行）
  - [x] 12.1 search 模块接线：新建 `search_index` 表（`project_id` + `search_vector tsvector`）+ 原生 SQL 幂等建 GIN 索引；建项目写索引、保存/删除编辑器文档同步维护；`GET /projectSearch/search?q=&limit=`（兼容旧路由 `?searchWord=`）+ `POST /projectSearch/rebuild` 回填；已删除 `mock/flowchart_mock_data.ts`
  - [x] 12.2 修复 `project_manager.service.ts` 月份 `getMonth() + 1`
  - [x] 12.3 修复 `user.service.ts` 头像路径 `split(/[\\/]+/).pop()`
  - [x] 12.4 孤儿 schema 清理（2026-10-17 经用户确认已执行）：共删除 7 个零引用文件——`ai_response.schema.ts`（全仓零引用）、`flow.schema.ts` + `optimize.prompt.ts` + `layout.tool.ts`（互为孤岛）、`memory/pg.config.ts`（PgSummaryConfig 孤儿）、`jwtRedis/redis_cache.{module,service}.ts`（整文件注释态）；相关悬空注释（tools/index、tool.registry、prompts/index、ai.module、app.module、jwt.strategy、auth.module）、README 结构树、文档引用（storage.md/index.md）已全部同步；删除后复跑 tsc（仍 1 基线错误）/jest（218 passed 基线不变）/评估（54/54）零退化
  - [x] 12.5 N+1 与事务修复：`removeById` 改批量 `In(idList)` 存在性校验、项目+文档同事务级联删除、索引清理置于 commit 之后

- [x] Task 13 `[BE]`: 内置轻量 trace 与评估脚本
  - [x] 13.1 新建 `src/observability/`：`TraceService`（`@Optional()` 注入，未装配即 no-op）+ `trace`/`trace_step` 两表 + 摘要截断与脱敏 + 每日过期清理定时器（`unref`）+ 3 个查询路由（`JwtAuthGuard`）；`graph.ts` 9 阶段最小侵入埋点（意图/上下文/工具/挂起/生成/咨询/记忆/反思评估/反思重写）+ `startRun`/`finishRun`/5 处 `updateRun`
  - [x] 13.2 `trace.metrics.ts` 聚合：工具调用次数、反思回路次数、错误恢复步数、上下文利用率、6 种终止条件
  - [x] 13.3 `scripts/evaluation/`（cases/fake-llm/in-memory-trace/run）：52 用例、A 档确定性 48 PASS、离线 FakeLlmFactory、四类指标 + 模板匹配准确率、跌破阈值标红 `exit 1`、支持 `--filter`/`--skip-e2e`
  - [x] 13.4 补关键单测 4 个 suite 共 90 tests 全绿：`graph.validator.spec`（含 HAS_CYCLE 与内置模板回环）、`error.classifier.spec`、`trace.metrics.spec`、`project_search.service.spec`

- [x] Task 14: 端到端联调验证（**依赖 Task 1~13**）——本环境 PG 无法启动（无 PG/Docker 二进制，apt 安装与替代方案均被拒绝），运行时联调降级为静态核对 + jest/评估脚本替代证据；**数据库环境就绪后需按下列清单补跑运行时联调**
  - [x] 14.1 启动验证（环境阻塞降级）：PG 不可用 → 后端启动至 TypeORM 连接失败点，无 DI/模块接线错误迹象；前端 `pnpm install --frozen-lockfile` 补齐 @emotion/react（环境恢复，非新装依赖）后 `vite build` 通过（4651 modules，exit 0）
  - [x] 14.2 generate 链路（静态核对）：chat→think SSE→result 四态→confirm 契约与 aiClient 实现一致（ai.controller.ts:33-144）；评估脚本 B 档 6 个 e2e 离线实跑通过（54/54）
  - [x] 14.3 modify 链路（前端断言覆盖）：match 链 30/30 + ai-flow 17/17 断言绿；单项无歧义直接应用/多项弹确认面板/残差五归因
  - [x] 14.4 异常链路（静态核对 + 单测）：工具失败降级话术、429 AI_QUOTA_EXCEEDED、SSE 断连 watchdog、401/403 守卫矩阵、zod 400 均有代码与测试证据
  - [x] 14.5 人在回路（静态核对）：need_confirm 挂起 → confirm accept/retry + resumeToken 防重放 → 恢复执行（ai.service.ts:251-297）
  - [x] 14.6 保存/读取/导入导出、全文检索、undo/redo（静态核对 + 补齐实现）：editor 端点 + X6 history 就绪；**补齐 home 项目列表搜索入口**（Input.Search 300ms 防抖接 `GET /projectSearch/search`，命中内容列/空态/在途请求取消/失败不阻塞，与文档「项目管理模块的搜索」承诺对齐）；jest 218 passed 无新增失败

## 阶段二：文档与代码双向对齐

- [x] Task 15 `[DOC]`: 提取文档到工作区（不回滚任何本地改动）
  - [x] 15.1 `git checkout origin/master -- docs/ai-tech`（纯新增文件），确认 14 篇 md + 2 张图完整落地（`git status --porcelain` 显示 docs/ai-tech 下 19 个文件均为 `A` 新增，零回滚）
  - [x] 15.2 侧边栏配置核对：projectDemo 为 VuePress 2 + hope 主题，原本无任何 ai-tech 条目；已补 `sidebar.ts`（`/ai-tech/` 分组，5 个子分组 17/17 全命中）+ `navbar.ts`（语图技术方案入口）+ 修复 `config.ts` 既有阻断 bug（用 path.resolve 未 import path）；TS 转译校验通过

- [x] Task 16 `[DOC]`: 逐篇校验修订（**依赖 Task 14、15**；16.1~16.5 可并行）
  - [x] 16.1 `index.md`（15 处：LangGraph→自研状态机、@antv/layout→自研布局、Langfuse→自建 observability、pgvector→JSONB+JS 余弦、版本表与模块划分、数据结构与模型分层、四级匹配更正）+ `frontend/index.md`（12 处：补 pages/ai/ 七目录 AI 链路小节、配色表/端口表对齐代码、canvas 仅节点三元组）+ `frontend/editor.md`（editData→editorDocument 实际端点、新增 Stencil/属性面板/工具栏/useGraph 四节）
  - [x] 16.2 `ai-runtime.md`（整篇重写为自研状态机实际流转 + 四端点协议）+ `intent.md`（规则参数 0.5+词数×0.15、LLM 兜底 6s、新增注入过滤第零级——实际 9 类 reject）+ `reflection.md`（HAS_CYCLE warning 不阻断、GraphIssueType 10 类、Rewriter ≤2 次、挂起/恢复实际机制）+ `context.md`（8 段拼装、32k/×0.8/ceil(len) 估算、LAST_K=3/SUMMARY_MAX=3/RETRIEVED_MAX=5、遗忘半衰期 14 天）
  - [x] 16.3 `memory.md`（24 处：pgvector→jsonb+JS 余弦、RRF k=60 top-10 + listwise 重排 top-3、CANDIDATE_LIMIT=200、遗忘对数放大上限 3 倍、画像 InMemory 现状）+ `streaming.md`（17 处：三事件、四态、confirm 契约、watchdog/退避/watchdog 兜底、thread-cleaner）+ `tool-calling.md`（20 处：白名单注册表现状、template_match 编排层短路 0 token、重试与脱敏实际参数、MCP/Skill 标演进项）
  - [x] 16.4 `backend/index.md`（模块现状清单、ProjectSearchModule 注释原因）+ `backend/auth.md`（PG 令牌态 sha256、@Public 唯一豁免、JWT_SECRET 强制、归属校验、配额三级）+ `backend/storage.md`（PG 单库、9 张数据表清单、tsvector+GIN 实现细节）+ `backend/deploy.md`（14 处 + 环境变量完整清单（DB_PASSWD 等实际变量名）+ 多实例演进项 + LLM 无 key 降级行为 + 失效链接修复）
  - [x] 16.5 `evaluation.md`（Langfuse→内置 trace、9 阶段埋点、指标对齐脚本六项、52 用例实测 54/54、边界回归覆盖表）+ `security.md`（12 处：令牌态/配额/注入 9+2/脱敏规则清单/边界行为表）+ `engineering.md`（质量属性表对齐、工程规范基线、CI 发版闸门、交互边界场景、快速上手）
  - [x] 16.6 全量补充：边界规则（空/超长输入、环图、意图歧义、工具全失败、配额耗尽、SSE 断连、done 早于订阅）、使用说明（浮窗三种用法）、部署指引（环境变量清单/上线检查/多实例注意）已分散落入 16.1~16.5 各篇；全部 17 篇均附 2026-10-17 变更记录

- [x] Task 17: 以定稿文档为基准做全量代码走查（**依赖 Task 16**；17.1~17.3 可并行）
  - [x] 17.1 `[FE]` 走查（57 文件全覆盖，修 21 文件）：preView/x6Editor 重复 dataClean 合并、孤儿导出清理、blank:click 全图 toJSON console.log 删除、QueryClient 模块级、G6Translate 悬挂 Promise/JSON.parse 无捕获/4 处 mutateAsync 无 catch/4 个 server.ts onError 对 HttpError 兼容/render 期 notification 移 useEffect、21 处 console.log 清理；复验 tsc 0 错误 + 断言 137/137 + build exit 0（4650 modules）
  - [x] 17.2 `[BE]` 走查（修 14 文件）：forget.scheduler 漏网 unhandledRejection（裸 Promise.race）修复、thread-cleaner 回调兜底 + 联动清理 Checkpoint、main.ts bootstrap.catch + 进程级兜底、导出 writeFileSync→async、日志目录缓存、拦截器每请求 stringify 降 debug、quota/entity-slot 5000 上限 LRU、console.*→Logger、死代码清理；复验 tsc 仍 1 基线错误 + jest 218 passed 失败集合不变 + 评估 54/54
  - [x] 17.3 走查修复已逐项复验（上述三组数字即 Task 14 验证口径的复跑结果，全部持平或更好，零退化）
  - [x] 17.4 `[RPT]` 《代码迭代变更说明》已输出：`code-iteration-changelog.md`（按前端/后端模块列变更点、修复缺陷、待用户同意删除清单、验证结果汇总）

## 阶段三：产品功能建议

- [x] Task 18 `[RPT]`: 同类产品调研与建议报告（可与阶段二并行）
  - [x] 18.1 调研 13 类 15+ 款主流产品：Napkin AI、Eraser DiagramGPT、Whimsical AI、Miro AI、Lucid/Lucid AI、Visio+Copilot、ChatGPT Canvas、Claude Artifacts、draw.io 生态、Mermaid Chart、Excalidraw TTD、ProcessOn AI 3.0、GitMind、亿图/万兴 EdrawMax；44 条可溯信息来源
  - [x] 18.2 梳理现有能力基础 + 16 项差距（G1~G16），结论「差距不在 AI 内核而在结果交付与工作流集成」
  - [x] 18.3 输出 `product-feature-recommendations.md`（865 行，五节 + 附录）：14 条建议 R1~R14 与 G1~G16 一一映射，每条 6 项必备字段全覆盖（84/84），优先级分布 P0×5 / P1×6 / P2×3，八维度全覆盖，全部满足「不引入新基础设施硬依赖」约束，无任何工期估计

- [x] Task 19: 全量功能验证与交付收口（**依赖 Task 14、17、18**）
  - [x] 19.1 全量复验（实跑）：前端 tsc 0 错误 + vite build exit 0（4650 modules）+ 断言 137/137（22/33/30/17/35）；后端 tsc 恰 1 个既有基线错误 + jest Suites 5 failed(基线)/18 passed、Tests 2 failed(基线)/218 passed + 评估脚本 通过 54 | 失败 0 | 跳过 0 exit 0（六项指标全 100%）
  - [x] 19.2 文档-代码对齐抽查 16 条（配色/尺寸/端口、短路/挂起、四态/confirm、RRF/Reranker/CANDIDATE/遗忘参数、sha256/24h/配额默认值、六项指标、注入 9+2、环境变量 5 项默认值等）零不一致；17 篇文档 17/17 含变更记录
  - [x] 19.3 四项交付物齐备：① 可运行项目包（前端可构建可运行；后端运行时联调受 PG 环境限制，静态+测试证据齐备，DB 就绪后按 Task 14 清单补跑）② 优化后语图文档（projectDemo/docs/ai-tech 17 篇）③ `code-iteration-changelog.md` ④ `product-feature-recommendations.md`（R1~R14）
  - [x] 19.4 checklist 勾选：76/77 通过；唯一未勾项为「注册登录→建项目→进编辑器浏览器全流程实跑」（本环境无 PG 无法启动运行时，已在 checklist 留痕，环境就绪后补跑）；走查后新增的 home 搜索入口已补验（tsc 0/build 0/断言 137/137）并回填 checklist L61

# Task Dependencies

- Task 2 依赖 Task 1（布局消费转换层的节点尺寸）
- Task 3 依赖 Task 1（匹配结果需落到 X6 元素）
- Task 5 依赖 Task 1、2、3、4
- Task 6 依赖 Task 1
- Task 9.5 与 Task 5.4 互为前后端配对，需协同
- Task 14 依赖 Task 1~13
- Task 15 可与阶段一并行（仅文档提取，不改代码）
- Task 16 依赖 Task 14、Task 15
- Task 17 依赖 Task 16
- Task 18 可与阶段二并行
- Task 19 依赖 Task 14、17、18
- 可并行分组：{Task 1, Task 7, Task 10, Task 15}、{Task 2, Task 8, Task 11}、{Task 3, Task 9, Task 12}、{Task 4, Task 13, Task 18}、{Task 16.1~16.5}、{Task 17.1~17.2}
