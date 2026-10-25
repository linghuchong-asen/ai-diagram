# 代码迭代变更说明

> 变更日期：2026-10-17 ｜ 变更范围：`/root/workspace/ai-diagram`（frontend + serverend）｜ 规格依据：`spec.md`（align-yutu-doc-and-code）
> 本文按模块汇总本次迭代的全部代码变更、修复缺陷、影响面与验证结果。逐任务明细见 `tasks.md`。

## 〇、总览

| 维度 | 前端 | 后端 |
|---|---|---|
| 新增模块 | pages/ai/{transform,layout,match,session,confirm-card,preview,modify}、utils/aiClient.ts | ai/{intent,memory,context,quota,security}、observability/、scripts/evaluation/、search 接线、TokenStore |
| 重构模块 | x6Editor（Stencil/属性面板/工具栏/useGraph）、ai_float_window | ai.controller/service、graph.ts 编排、auth（守卫/令牌态）、projectManager |
| 删除 | utils/sse.ts（孤儿 SSE 实现）、内联 SVG FlowPreview、若干孤儿导出 | projectSearch mock 数据、若干死代码/无用导入 |
| 验证基线 | tsc 0 错误、vite build 通过、断言 137/137 | tsc 仅 1 个既有基线错误、jest 218 passed（失败集合与基线一致）、评估脚本 54/54 |

---

## 一、前端（frontend/src）

### 1. AI 链路新模块（Task 1/2/3/4/5）
- **transform/**：`NODE_TYPE_CONFIG`（6 种语义节点 shape/尺寸/配色/attrs）、`getPortsForType/buildPorts`（start 仅 bottom、end 仅 top、其余四向）、`normalizeFlowDraft`（降级非法 type→process 并记 rawType）、`flowDraftToX6`（FlowDraft→X6 元数据，含 droppedEdges）、`x6ToFlowDraft`（反向）。**影响**：AI 生成/修改与编辑器手绘共用同一套节点元数据，`graph.toJSON()/fromJSON()` 数据互通。
- **layout/**：`autoLayout`（最长路径分层，LEVEL_GAP=110/NODE_GAP=60/PADDING=60，环图 guard，重心排序）、`findFreeSpot/resolveCollisions`（先下后右步进避让）、`placeNewNode`（relativeTo+direction 相对定位→质心兜底→碰撞步进）。**影响**：替代 @antv/layout 依赖（项目从未安装），零新增依赖。
- **match/**：四级降级匹配（L1 id 精确 1.0 → L2 label+type 归一化 0.9 → L3 拓扑签名 0.75 → L4 边校验 0.3），`buildApplyPlan/applyOperations`（7 种 patch op、滚动工作快照、前向引用、选择性应用 selectedIndexes、歧义裁决 resolvedAmbiguous、残差五归因 unselected/unmatched/ambiguous/duplicate/invalid）、`ApplyPlanPanel`（antd 4 纯受控组件）。**影响**：modify 链路漏写 id 不误删、未匹配项显式呈现。
- **utils/aiClient.ts**（912 行）：`startChat/connectThink/pollResult/confirmChoice/runAiSession` 五 API；SSE 三事件解析 + 命名事件兜底帧；轮询退避 1s→2s→3s + Retry-After clamp[250ms,10s] + 总超时 120s；`HttpError`（message/status/data/bodySummary）；三条清理路径统一 `cleanup()`（EventSource + 定时器 + AbortController，均幂等）；`STREAM_WATCHDOG_MS=2000` 兜底「done 早于订阅」竞态。**删除**：`utils/sse.ts`（delta/token 字段冲突的孤儿实现，grep 零引用）。`http.ts` catch 由 `JSON.stringify(err)`（恒为 "{}"）改为 `toHttpError()`。
- **ai_float_window 重写**（364→约 500 行）：统一走 `runAiSession`；canvas 摘要（`x6ToFlowDraft`→节点三元组）；generate 只读 X6 预览 + 「应用到画布」（非空画布整体右移避让）；modify 走匹配链（单项无歧义直接应用/多项弹 ModifyPlanModal）、残差逐行归因展示；人在回路确认卡片（reason/issues/candidates 单选/≤500 字 instruction/resumeToken 透传，确认前画布零变更）；卸载/收起 `abort()`；删除硬编码「已应用 N 项修改操作」文案与自建 EventSource/轮询。

### 2. 编辑器统一语义节点体系（Task 6）
- `node_types.tsx`：Stencil 从 image+SVG 改为 6 种语义节点（复用 `toX6Node`，预览 0.5 缩放），补齐拖放入画布（getDropNode 重建真实尺寸，`data.origin='canvas'`）。
- `ConfigNode`：fill 修为 `body/fill`（原 key 不生效）；`node:moved/node:resized` 卸载解绑（修泄漏）；changePorts 死代码移除。
- `ConfigEdge`：颜色改读写 `labels[0].attrs.label.fill`（原 `text/fill` selector 不存在、改动完全无效）。
- `configPanel/index.tsx`：恢复 ConfigGrid 入口（blank:click→clickType=3 分支上移，原分支被注释导致永不可达）。
- `toolBar.tsx`：快捷键移入 useEffect + `unbindKey` 清理（原每次 render 重复绑定）；缩放改 `zoomTo` 绝对值 + 显示同步；isSave 死逻辑收敛；history change 泄漏修复。
- `useGraph.tsx`：画布尺寸自适应容器（原固定 1920×1080）+ ResizeObserver + dispose；小地图删除边屏蔽逻辑（小地图现含边）；`index.tsx` 重复 cell:dblclick 注册合并。

### 3. 走查修复（Task 17.1，21 个文件）
- **冗余**：preView/x6Editor 重复 dataClean 合并；utils/index.ts、components/lib.tsx 孤儿导出删除；http.ts 注释死代码删除；多处未用导入清除。
- **性能**：blank:click 中全图 toJSON 的 console.log 删除；QueryClient 提升为模块级单例。
- **异常**：G6Translate 非法 JSON 悬挂 Promise 修复（try/catch+onerror）；home 导入 JSON.parse 无捕获修复；4 处保存/导入 mutateAsync 无 catch 补齐；4 个 server.ts 的 onError 对 HttpError 的兼容（可选链+兜底文案）；render 期间 notification 移入 useEffect（严格模式重复弹出）。
- **规范**：21 处 console.log 清理（断言输出通道除外）；ConfigGrid/ConfigEdge 的 any 收紧。

---

## 二、后端（serverend/src）

### 1. AI 编排与意图（Task 7/8/9）
- **intent/**：规则识别（命中强度 0.5+词数×0.15、CONFIDENT_SCORE=0.5）→ LLM 兜底（medium 模型 + zod 枚举 + 6s 超时，失败回落并记 intentSource）。
- **tools/**：白名单注册表（template_match/validate_graph；layout 移出白名单，布局归前端）；`template_match` 编排层短路（命中 0 token）；ToolExecutor（zod 参数校验 + 封顶：数组 top-5/字符串 2000/深度 4）；分级重试（network 指数退避 200/400/800ms ≤3、param 结构化纠错 ≤3、耗尽受控降级话术）；error-sanitizer（密钥/路径/堆栈脱敏，仅 message_for_llm 进上下文）；tool-context.store（LRU 200 + TTL 10min）。
- **reflection**：HAS_CYCLE 环检测（DFS 三色染色，severity=warning 不阻断——审批退回属合法回环）；Rewriter 只喂 error 级、按 nodeIds 限定、≤2 次，超限 `suspendForHumanConfirm` 转人在回路；thread-cleaner（5min/30min TTL/unref）；`executeGraph` finally 全路径 `thinkStream.end()`。
- **协议**：result 四态（202 pending+Retry-After / need_confirm / error / done）+ `POST /ai/confirm/:threadId`（accept/retry + instruction≤500 + candidateId≤64 + resumeToken 防重放）；ai 四端点 `@SkipInterceptor()`（裸 JSON）；think SSE `@Public()`（EventSource 无法带 Authorization，threadId=randomUUID 即凭证）。

### 2. 记忆体系与上下文预算（Task 10）
- 滚动摘要每 2 轮（窗口 12 条/单条 120 字/8s 超时）写 `conversation_summaries`，LLM 不可用退化规则摘要；Checkpointer 接口 + 内存/PG 双实现（`CHECKPOINT_STORE`）。
- 长期记忆：`ai_long_term_memories`（向量存 jsonb，无 pgvector），双路召回（关键词计分 + 向量路：命名空间内有界候选 200 条 JS 余弦）→ RRF(k=60) top-10 → listwise Reranker top-3（6s 超时）→ degraded 降级记录；`EMBEDDING_PROVIDER` 可插拔（默认 openai/text-embedding-v3，不可用标 unavailable 单路退化）。
- 遗忘曲线：每周定时器（启动 1 分钟首扫 + unref），weight=exp(-0.693·days/halfLife)，半衰期基础 14 天 + 访问对数放大（上限 3 倍），>0.5 保留 / 0.3~0.5 再压缩 / <0.3 删除。
- 上下文组装：8 段拼装，分段预算 0.4/0.2/0.15/0.1/0.1/0.05，总量卡 32k×0.8，超限截断+配额借用，token 估算 ceil(len)；实体槽不参与截断；话题切换（窗口 3/阈值 0.5，向量退化 Jaccard）。
- 命名空间隔离：长期记忆按 project_id、画像按 user_id（assertUserNamespace）；**修复真实 bug**：`executeGraph` 误将 sessionId（user:project 格式）传给画像 ingest 导致每轮报错 → 改传真实 userId。

### 3. 安全加固（Task 11）
- 鉴权：JwtAuthGuard 类级 + `@Public()` 装饰器（Reflector）；ai/project/editor/projectSearch/observability 全量覆盖；AiModule imports AuthModule。
- 归属校验：ProjectEntity 增可空 userId；findAll 过滤本人+未归属（历史 NULL 放行兼容存量）；findById/update/remove/export 校验；统一 403 文案「无权访问该项目」不泄露存在性。
- 令牌态：TokenStore 接口 + PG 默认实现（`auth_tokens` 表只存 sha256 摘要、唯一索引）；`/auth/logout` 主动吊销 + JwtStrategy 每请求查吊销（passReqToCallback）；`TOKEN_STORE` 可切。
- 配置：CORS `*` → 白名单函数（CORS_ORIGINS，默认 localhost:5173/3000）；JWT_SECRET 强制环境变量（缺失/历史默认值启动报错并给指引）；`DB_SYNCHRONIZE` 开关（production 默认 false）。grep 确认无真实兜底 LLM key；LLM 无 key 时降级可用 + 启动警告。
- 配额三级：用户级 `ai_daily_usage` 原子 upsert（generate 200/modify 500/token 500k 日限，429 AI_QUOTA_EXCEEDED）；会话软上限 100k×80% → AiResult 附 notice；调用级 LLM_MAX_OUTPUT_TOKENS=4096 + 超长按格式问题走 Rewriter。
- 注入防御：prompt-injection（9 类 reject + 2 类 strip，reject 返回受控话术不进模型）+ anchorSystemPrompt 角色锚定，接入点在意图识别前。

### 4. 检索/缺陷/可观测（Task 12/13）
- 检索：`search_index` 表（project_id 主键 + tsvector）+ 原生 SQL 幂等 GIN 索引；建项目/存取文档联动维护；`GET /projectSearch/search`（中文单字+二字切分 + ILIKE 兜底 + LIKE 转义防注入）+ `/rebuild` 回填；mock 数据删除。
- 缺陷修复：导出文件名月份 `getMonth()+1`；头像路径 `split(/[\\/]+/)`（原 `'\\'` Linux 失效）；removeById 批量 In() 消 N+1 + 项目/文档同事务级联删除 + 索引清理置于 commit 后。
- 可观测：`trace`/`ai_trace_step` 两表按 threadId 记录 9 阶段（意图/上下文/工具/挂起/生成/咨询/记忆/反思评估/反思重写）+ TraceService @Optional no-op + 步骤封顶 200/摘要 300 字符脱敏/保留 14 天自动清理 + 3 个查询路由；`computeTraceMetrics` 聚合（工具调用/反思回路/错误恢复/上下文利用率/6 种终止条件）。
- 评估脚本 `scripts/evaluation/`：52 用例（A 档确定性 46 + B 档端到端 6，内置模板展开后 54 条记录），FakeLlmFactory 离线可跑，六类指标阈值标红 exit 1，`--filter/--skip-e2e`。

### 5. 走查修复（Task 17.2，14 个文件）
- **异常**：forget.scheduler 裸 Promise.race 计时器不清理（漏网 unhandledRejection）→ withTimeout+clearTimeout；thread-cleaner 定时回调 try/catch + 联动清理短期 Checkpoint；main.ts bootstrap .catch + 进程级 unhandledRejection/uncaughtException 兜底。
- **性能**：导出接口 writeFileSync → fs.promises；日志目录存在性缓存；拦截器每请求函数对象 stringify 降 debug；quota sessionUsage 与 entity-slot slots 加 5000 上限 LRU（InMemoryCheckpointSaver 获 TTL 联动清理）。
- **冗余/规范**：graph.ts 自赋值死代码、拦截器 5 处死代码、writeLongTerm 死参数、无用导入删除；console.* → Logger。

---

## 三、孤儿代码删除（2026-10-17 经用户确认，已全部执行）

删除前逐项重新 grep 确认零活跃引用（仅注释/孤岛互引/README 结构树提及），删除清单：

1. `serverend/src/ai/schemas/ai_response.schema.ts`（全仓零引用）
2. `serverend/src/ai/schemas/flow.schema.ts`（仅被同为孤岛的 3/4 引用）
3. `serverend/src/ai/prompts/optimize.prompt.ts`（无消费方，prompts/index.ts 注释同步更新并注明删除）
4. `serverend/src/ai/tools/layout.tool.ts`（白名单已移除其注册；tools/index.ts 与 tool.registry.ts 悬空指针注释已更新）
5. `serverend/src/ai/memory/pg.config.ts`（PgSummaryConfig 孤儿，ai.module.ts 注释同步更新）
6. `serverend/src/jwtRedis/redis_cache.module.ts` + `redis_cache.service.ts`（整文件注释态旧实现；app.module.ts / jwt.strategy.ts / auth.module.ts 的注释态 import 与 README.md 结构树已清理）

**随删同步**：`jwt.strategy.ts` 移除未读取的 `userRepository` 注入（连带 `@InjectRepository`/`Repository`/`UserEntity` 导入），`ConfigService` 改普通参数（super() 前不可用 this，参数属性从未被读取）；文档侧 `backend/storage.md`（3 处 jwtRedis 表述 + 全文检索小节补孤儿清理说明 + 变更记录）与 `index.md`（修正过期表述「Redis 仅负责登录鉴权（JWT 令牌态）」→ 令牌态落 PG auth_tokens）已同步。
**同类遗留**：`ai/prompts/suggest.prompt.ts` 现与 optimize 同性质（仅 prompts/index.ts 注释提及、无消费方），不在本次确认清单内故保留，如需一并删除请示意。

## 四、验证结果汇总（收口数字）

| 验证项 | 前端 | 后端 |
|---|---|---|
| 类型检查 | tsc --noEmit **0 错误** | tsc --noEmit 恰 **1 个既有基线错误**（transform.interceptor.spec TS2554，非本次引入） |
| 构建 | vite build **exit 0**（4650 modules） | ——（启动需 PG，本环境不可用） |
| 单测/断言 | 断言脚本 **137/137**（transform 22/layout 33/match 30/ai-flow 17/aiClient 35） | jest **218 passed**（5 failed 套件与基线完全一致，0 新增失败） |
| 回归评估 | —— | **54/54 通过，exit 0**（格式合规 100%/图结构 100%/意图 100%/工具 100%/模板 100%/端到端 100%） |
| 运行时联调 | 本环境无 PG/Docker，API 级联调降级为静态核对 + 测试替代证据；DB 就绪后按 tasks.md Task 14 清单补跑 | 同左 |
