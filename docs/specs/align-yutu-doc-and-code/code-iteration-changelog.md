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

---

# 变更记录：增长快赢批次一（growth-quick-wins-batch1，2026-10-26）

> 规格依据：`docs/specs/growth-quick-wins-batch1/spec.md`（源头：`docs/growth/语图-推广运营体验-多轮头脑风暴-2026-10.md` §3.2 快赢区）
> 主题：可测性（埋点/归因）+ 转化摩擦修复（试用 2 次/注册墙/首单价/额度三选一）+ 水印回流。
> 验证：后端 jest **32 套件 / 319 用例全绿**（原 230 → 319）；前端 tsc 0 错误 + vite build 通过（4670 modules）；后端 tsc 0 错误。

## 后端（serverend/src）

- **observability/growth-track.controller.ts（新增）**：公开端点 `POST /growth/track`，承接访客侧 CTA 点击事件（白名单 share_cta_click / share_template_click，复用 ShareRateLimitGuard，字段截断 ≤128）。ObservabilityModule 注册。
- **projectShare**：`viewShare` 成功路径记 `share_view`（projectId+token，不带用户身份）；新增 `POST /share/duplicate/:token`（JWT）—— 复制公开画布为登录用户的新项目（重名加序号、解锁态不继承、记 `share_duplicate` 事件）。
- **ai/ai.service.ts**：试用台账 trialId 日限 1 → 2（env `AI_TRIAL_PER_ID_PER_DAY` 可覆盖回调为 1）；同 IP 日限 3 → 6（校园 NAT 余量）；TRIAL_USED 文案更新为「今日免费试用次数已用完（每日 2 次）…」。
- **billing**：首单优惠 —— 名下无 paid 订单按 `FIRST_UNLOCK_PRICE_FEN`（默认 90 分）下单并返回 `firstOrder` 标记；`unlock_pay` 事件新增 `firstOrder` 字段（区分首单转化/复购）。
- **user**：`CreateUserDto` 新增可选 `channel`（≤64，仅埋点不落库）；`register` 事件携带渠道归因（入口 ?ch=/utm_source/from 捕获）。
- **ai/quota/quota.service.ts**：生成额度用尽 hint 补「模板一键生成不消耗额度」（与前端三选一对齐）。

## 前端（frontend/src）

- **utils/channel.ts（新增）**：入口渠道参数捕获（首触达优先、字符白名单、≤64）；main.tsx 渲染前调用。
- **pages/share**：新增「复制这张图开始编辑」（登录复制直达编辑器 / 未登录 `?redirect=` 跳登录）+ 底部 2 个热门模板推荐位 + CTA 埋点（sendBeacon/keepalive）+ 水印可点（link 模式）。
- **pages/login（login/register/server）**：`?redirect=` 双向透传（分享页→注册→登录→回分享页动线）；注册请求携带 channel。
- **pages/ai/ai_float_window.tsx**：TRIAL_USED 文案片段对齐 + 注册引导卡强化（「注册保存这幅图」）；配额 429（AI_QUOTA_EXCEEDED）改为三选一引导卡（去分享领 +1 次 / 模板中心不耗额度 / 明日再来）；试用态脚注改「免费试用每日 2 次」。
- **pages/home/landing.tsx**：快捷 chips 从固定 3 条改为 4 组场景（校园毕设/职场/电商/研发）按日轮换，占位文案同源轮换；副标语改「免登录免费试 2 次」。
- **pages/preView**：解锁弹窗 pay/sponsor 两态新增价格锚点（「同类工具解锁一年要 ¥199+，语图按张付费」）与「首单特惠」标记（读服务端 firstOrder）。
- **pages/shared/WatermarkOverlay.tsx + theme/tech-theme.css**：水印可选 link 模式（仅主文案一行恢复 pointer-events，回首页）。
- **utils/exportImage.ts**：免费档导出水印在品牌文案下追加站点地址行（当前 origin），导出物可按图回流。

## 测试

- project_share.service.spec：+5 用例（share_view 成功/404、duplicate 正常/重名序号/无效 token）。
- billing.service.spec：+3 用例（首单默认 90、env 覆盖、非首单 190 + firstOrder 标记）；2 用例适配 firstOrder 字段。
- ai.service.spec：试用台账用例重写（第 2 次放行、第 3 次拦截、env 回调为 1、IP 第 7 次拦截、全局 100 回归）。
- user.service.spec：+2 用例（channel 归因截断清洗、无 channel 缺省）。

## 未纳入（记录在案）

og:image（待设计资产）、知乎卡位/导航站收录/公众号兑换码（运营动作）、虎皮椒回调人工验证（上线红线，见增长一页纸 §9.5）。

---

# 变更记录：魔性传播批次一 · 分享卡工厂（viral-card-batch，2026-10-26）

> 规格依据：`docs/specs/viral-card-batch/spec.md`（源头：`docs/growth/语图-魔性传播与商业化-功能战略头脑风暴-2026-10.md` 赌注一）
> 验证：后端 jest **33 套件 / 325 用例全绿**（+6）；前端 tsc 0 错误 + vite build 通过。

- **前端新增**：`utils/shareCard.ts`（3:4 分享卡工厂：X6→SVG→Canvas 合成，品牌句常驻）；`pages/fun/`（脑洞显影卡，6 梗场景入口）；`pages/digest/`（一图看懂，≤500 字与试用 schema 对齐）；路由 `/fun` `/digest`；首页魔性玩法入口。
- **前端集成**：试用页顶栏 + 预览页工具栏新增「导出分享卡」（标题分别取试用草稿 prompt / 项目名）；`utils/exportImage.ts` 导出 `renderGraphToSvg` 供卡片复用。
- **后端**：growth-track 白名单 +3（card_export / fun_chip_click / digest_submit）；新增 `growth-track.controller.spec.ts`（6 用例）。

---

# 变更记录：代码年报（Round B）+ 模板场景扩充（Round C，2026-10-26）

> 规格依据：`docs/specs/annual-report-batch/spec.md`、`docs/specs/template-scene-batch/spec.md`
> 验证：后端 jest **34 套件 / 333 用例全绿**；后端 tsc 0 错误；前端 tsc 0 错误 + vite build 通过；回归评估闸门 **54/54 通过**（模板扩充无匹配回归）。

## Round B · 代码年报（annual-report-batch）

- **后端新增 `operationalModules/annual/`**：`GET /annual/report?source=github|gitee&user=&year=`（公开 + 限流）；只读上游公开仓库 API（无 token/无个人信息收集），确定性聚合（公开仓库数/年内新建/年内活跃/累计 Stars/新仓库 Stars/语言 Top5/最星仓库/最近 push，单页 100 截断标记）；5 分钟内存缓存 + 用户名白名单（防 SSRF）；错误映射 404→404 / 403→429 / 网络异常→502；埋点 `annual_generate`。app.module 注册 AnnualModule。
- **前端新增 `pages/annual/` + `utils/annualCard.ts`**：GitHub/Gitee 切换 + 年份选择 → 统计宫格 → 导出 3:4 年报卡（复用分享卡工厂视觉；诚实口径注常驻）；路由 `/annual`（公开）；首页入口；页内留存桥 CTA → /trial；`card_export(channel:annual)` 埋点。
- **测试**：`annual.service.spec.ts` 7 用例（聚合口径/Gitee 归一化/截断/错误映射/参数校验不打上游/缓存大小写不敏感去重/空仓库零值）。

## Round C · 模板场景扩充（template-scene-batch）

- `template.service.ts` 静态数组 12 → 16：+会议纪要转泳道图（B6）、+PRD 转用户流程图（B7）、+论文技术路线图（B1 先导）、+年终述职一图流（A6）；分类仍为校园/职场/电商/研发四类。
- `template.service.spec.ts`：数量断言 12→16 + 新 id 在列断言（+1 用例）。
- 《增长运营一页纸》§5 模板关键词表同步扩充（16 行）。

---

# 变更记录：Round D/E/F（Mermaid 导出 + 思维体质图 + 文件输入，2026-10-26）

> 规格依据：`docs/specs/mermaid-export-batch/spec.md`、`docs/specs/mind-quiz-batch/spec.md`
> 验证：后端 jest **34 套件 / 334 用例全绿**；前端断言脚本 **8 个全绿（164/164，含新增 3 个）**；前端 tsc 0 错误 + vite build 通过；回归评估闸门 **54/54**。

## Round D · Mermaid 导出（R3 档二）

- 新增 `utils/toMermaid.ts`：FlowDraft → Mermaid flowchart（六种语义节点形状映射、id 归一去重、标签/边标签清洗、悬空边丢弃、`%%` 署名注释）；预览页新增「Mermaid」按钮 + 代码弹窗（复制/下载 .mmd）。
- 新增 `utils/__checks__/toMermaid.check.ts`（10 用例）。
- **修复存量断言漂移**：transform.check.ts 两处边默认描边预期 `#A3B1BF` → `#7d8fb0`（Neon Dark 有意行为，三处同色），transform.check 由 20/22 → **22/22**。

## Round E · 思维体质图（/mind）

- 新增 `pages/mind/`：archetype.ts（纯函数映射：5 题 × 4 倾向、计点制、平票确定性、四原型档案与定制 prompt）+ 答题页（提交锁定）+ 路由（公开）。
- 后端 growth-track 白名单 + `mind_complete`；spec +1 用例。
- 新增 `pages/mind/__checks__/archetype.check.ts`（9 用例）。

## Round F · 一图看懂文件输入

- 新增 `utils/textFile.ts`：readTextFile（.txt/.md 白名单 + 2MB 上限 + 客户端读取不落盘）、clipToLimit（Unicode 码位安全截断）；digest 页上传入口（超 500 字截断提示注册解锁）。
- 新增 `utils/__checks__/textFile.check.ts`（8 用例）。

## 本日三轮累计（A-F）

后端 319 → **334 用例**；前端断言 115/137 基线（2 存量失败）→ **8 脚本 164/164 全绿**；新增公开入口 6 个（/fun /digest /annual /mind + 模板 16 + Mermaid 导出）；新事件 7 个（服务端 2 + 客户端 5）。

---

# 变更记录：场景工厂 · 十轮真实使用场景（scenario-factory-batch · Round G-P，2026-10-26）

> 规格依据：`docs/specs/scenario-factory-batch/spec.md`
> 验证：后端 jest **35 套件 / 348 用例全绿**；前端断言 **13 脚本 214/214**；前后端 tsc 0 错误；vite build 通过（4692 modules）；回归评估闸门 54/54。

## 基建（Round G）

- 新增 `pages/scenarios/`：registry（场景注册表，ScenarioConfig 契约）+ ScenarioPage（通用场景页 `/s/:id`）+ ScenariosIndexPage（场景库 `/scenarios`）；首页新增「场景库」入口。
- 后端 growth-track 白名单 + `scenario_submit`（channel 区分场景，加场景零白名单改动）。

## 九个场景 builder（纯函数 + 断言）

- weekly-report（周报行分组）/ sql-ddl（CREATE TABLE 解析：列/PK/FK/括号深度/注释）/ pseudo-code（缩进伪代码：中英关键字 + 控制流统计）/ travel（Day 多标记归一）/ jd-interview（技能词典 + 经验学历提取）/ troubleshooting（五段 SOP）/ approval（链-条件-抄送三行式）/ git-log（hex 识别 + Conventional Commits 分类）/ okr（O/KR/动作三层归属）。
- 新增断言脚本 5 个共 50 用例：weekly-report 8、sql-ddl 10、pseudo-code 10、travel-jd 10、sop-approval-git-okr 12。

## 后端（Round J）

- 新增 `operationalModules/digestFetch/`：`POST /digest/url` 网页正文抓取（SSRF 防御：协议白名单 + 内网拒绝；Content-Type 白名单；1MB/8s 上限；启发式正文提取；5 分钟缓存；`digest_url_fetch` 埋点）+ 13 用例单测；digest 页新增「粘贴链接读取正文」入口。

## 过程中修复的实现缺陷（断言驱动发现）

- travel：预创建空默认组未清理（首行为 Day 标记时多出空「行程」组）。
- jd-interview：经验年限正则对「3 年以上 Java 开发经验」不命中（年限与「经验」间需容忍词组）。
- pseudo-code：中文关键字后 `\b` 不成立（汉字非 word char），改负向前瞻。
- git-log：示例假 hash 含非 hex 字符，统一修正为合法十六进制。

---

# 变更记录：多形态产物 Agent · 十轮（multi-artifact-batch · Round 1-10，2026-10-26）

> 规格依据：`docs/specs/multi-artifact-batch/spec.md` ｜ 技术说明：`docs/tech/artifact.md`
> 命题：不局限于流程图——把语图当作「解决问题的 Agent」：流程图是最核心场景，但产物可以是其他图（思维导图），甚至不是图（表格/清单/时间线）。
> 验证：后端 jest **40 套件 / 395 用例全绿**（+5 spec +47 用例，0 回归）；前端断言 **14 脚本全绿**（新增 artifact.check 15 用例）；前后端 tsc 0 错误；vite build 通过。

## 核心架构：意图与形态两级解耦

- `intent=generate` 不再等价于流程图：新增 **形式路由 FormRouter**（节点 1.5）——`formHint` 直通 → 关键词规则（零 token）→ LLM 兜底（medium 模型 4s 超时）→ 默认 flowchart。五形态：`flowchart | mindmap | table | checklist | timeline`。
- 每形态四件套：Zod Schema（`schemas/artifact.schema.ts`）+ 系统提示词（`prompts/artifact.prompts.ts`）+ 结构校验器（`reflection/artifact.validator.ts`，error/warning 两级）+ 前端渲染（`pages/ai/artifacts/`）。
- **向后兼容**：`generate` 响应 `artifactKind` 缺省视为 flowchart（仍只输出 flowDraft），旧前端/旧分享零影响；响应协议/接口路径/计量口径（quota、growth 埋点）均不变。

## 十轮交付

- R1 构思：10+ 痛点 → 5 形态映射（「形式追随问题」），spec/tasks/checklist 建立。
- R2-R5 后端四件套：Schema 11 用例 / FormRouter 11 用例 / Prompt 9 用例 / 校验器 9 用例（evaluator 扩展 artifact 分支，格式失败不叠加结构噪音）。
- R6 状态图接入：graph.ts 节点 1.5 形式路由 + generate 按 artifactKind 分支（解析/反思/Rewriter/人在回路全复用）；`Rewriter` 修正提示词按形态措辞；service `formHint` 透传 + confirm accept 按挂起形态还原候选；集成 spec 7 用例。
- R7 前端纯逻辑：aiClient 类型镜像；`artifacts/`（归一化/整洁树布局/Markdown 导出）；check 15 用例——**抓出 2 个实现缺陷**（自动补 id 与既有 id 撞车、时间线 Markdown 序号未递增）。
- R8 渲染集成：深色自绘渲染（表格/可勾选清单/时间线，Neon Dark CSS 变量）+ 复制 Markdown 出口；mindmap 经布局转换复用 `flowDraftToX6`+`X6FlowPreview` 进画布（可用全套流程图编辑能力）；浮窗快捷 chips +4 形态示例（带 formHint）。
- R9 全量回归（数据见上）；顺带修复存量 `textFile.check.ts` 纯 Node 缺 `FileReader` 的环境性崩溃（补 `File.text()` 等价桩，非本批次缺陷）。
- R10 文档：spec/checklist 勾选 + 验收证据、本记录、新增 `docs/tech/artifact.md`（架构 + 接口变更说明）。

## 接口变更（增量、可选字段）

- `POST /api/ai/chat`、`POST /api/ai/trial/chat` 请求体新增可选 `formHint`（五值白名单，非法 400）。
- `GET /api/ai/result/:id` 的 `generate` 分支新增 `artifactKind` + `mindmapDraft/tableDraft/checklistDraft/timelineDraft`（与 artifactKind 严格配对；缺省 flowchart 兼容旧结构）。
- 无数据库/部署变更。

---

# 变更记录：竞品驱动演进 · 二十轮（competitor-driven-evolution-batch · Round 1-20，2026-10-26）

> 规格依据：`docs/specs/competitor-driven-evolution-batch/spec.md`（tasks/checklist 于 R20 补建）
> 竞品依据：`docs/growth/竞品调研-AI图表生成工具全景-2026-10.md`（G1-G10 差距分析）
> 命题：基于同类产品（国际商业产品 + GitHub 开源生态 + 国内产品）深度思考二十轮演进，每轮写码写测试。
> 验证：后端 jest **42 套件 / 417 用例全绿**（基线 40/395，0 回归 + 新增 22 用例）；前端断言 **24 脚本全绿**（基线 14，新增 10）；前后端 tsc 0 错误；vite build 通过（4712 modules）。

## 五条主线

| 主线 | 差距 | 轮次 | 核心交付 |
|---|---|---|---|
| A DSL 互操作 | G1 | R2-R5 | Mermaid/PlantUML 解析器 + 方言识别 + 浮窗导入入口（对标 mermaid 70k★ 生态） |
| B 产物深度 | G9/G5 | R6-R9 | 表格加权打分 / 时间线自然排序 / 追问建议 / 行内编辑 |
| C 产物可携带 | G6/G4 | R10-R12 | Markdown 文件下载 / 会话内版本栈 / 本地草稿箱 |
| D Agent 智能深化 | G7/G8/G10 | R13-R16 | 四形态模板短路 / FORM_ROUTE 观测 / 会话形态偏好 / 注入对抗加固 |
| E 场景与增长 | G2/G7 | R17-R19 | 场景工厂 +4 / 模板中心多形态 / 试用页空态引导 |

## 前端交付（R2-R12、R17-R19）

- **DSL 导入**：`import/mermaid-parser.ts`（graph/flowchart、九形状、五箭头、subgraph→subprocess、`&` 并联、未闭合容错）、`import/plantuml-parser.ts`（栈式控制流机：if/while/repeat/fork）、`import/dsl-detect.ts`（围栏剥离 + 方言识别）；浮窗「导入DSL」→ 解析 → autoLayout + flowDraftToX6 预览链路。
- **产物深度**：`artifacts/table-scoring.ts`（加权分 + 成本列方向翻转 + 推荐结论）、`artifacts/timeline-sort.ts`（三级排序键）、`artifacts/followup-suggest.ts`（每形态 3 条追问 chips）、table-view 行内编辑（Enter/失焦提交/Esc 还原）。
- **可携带**：`artifacts/download-artifact.ts`（五形态 Markdown + .md 下载）、`session/history-stack.ts`（会话内版本栈 20 条）、`utils/artifact-drafts.ts`（localStorage 草稿箱 20 条）——浮窗「历史产物」Modal 支持回放（不耗额度）/复制/下载/删除/清空，`artifact-meta.generatePayloadOf` 按形态取 Draft 本体。
- **场景与增长**：场景工厂 registry 新增 `formHint` 契约 + 4 builder（comparison/todo-checklist/travel-plan/reading-map，纯函数）；模板中心「多形态」分类（4 条带 formHint，跳转拼 `&form=`）；`/trial` 空态四形态引导 chips + 自动首发语义扩展（同一 prompt+form 不重发、新组合才发、busy 挂起补发）。

## 后端交付（R13-R16）

- **模板短路**：`template-matcher.ts` 四形态内置模板（会议待办/技术选型/三天两晚/读书导图）+ `match(query, artifactKind)` 分库；`tool.registry` params 加 artifactKind；`graph` 节点 3 全形态调用，新形态命中按 `ARTIFACT_PAYLOAD_FIELD` 组装 result——高频请求零 token 秒回；flowchart 兼容红线不变。
- **观测**：`TRACE_STEPS.FORM_ROUTE = 'form.route'` + `ai_trace.artifact_kind` 列 + `updateRun({ artifactKind })`；节点 1.5 记录 kind/source/llmAttempted（恢复执行预置形态时跳过）。
- **会话形态偏好**：`applySessionPreference(usage)`（≥2 次且严格最多才采信）；`route` 第三参 `sessionFormUsage`；AiService 进程内当日台账（createThread 读快照 / 成功 generate 后累计，返回拷贝防污染）；绝不覆盖 formHint。
- **注入对抗加固**：四形态系统提示词数据边界/拒绝条款自检、anchorSystemPrompt 全形态生效且只追加、注入样本 reject/strip 行为一致、formHint 非法值双链路 Zod 拒绝。

## 接口与数据结构变更（增量）

- `GET /api/template/list`：条目新增可选 `formHint`；分类枚举新增「多形态」（16 → 20 条）。旧客户端只读既有字段，零影响。
- 数据库（生产需手工 DDL，开发 synchronize 自动）：`ai_trace` 新增 `artifact_kind varchar(16) nullable`。
- 无其它接口签名破坏性变更；`/trial` 新增 `?form=` 查询参数（非法值忽略）。

## 端口/红线

- `artifactKind` 缺省 = flowchart；flowchart 链路 result 不带 artifactKind 字段；template_match 既有流程图模板不回归；会话偏好绝不覆盖 formHint；前端类型镜像不 import 后端文件。

## 测试与验收

- 新增后端 spec：`graph.template-shortcut.spec.ts`（8）、`artifact-injection-hardening.spec.ts`（4）；扩展 `graph.artifact.spec.ts`（+3）、`form.router.spec.ts`（+5）、`template.service.spec.ts`（+1）。
- 新增前端 check：mermaid-parser（28）、plantuml-parser（11）、dsl-import（6）、table-scoring（9）、timeline-sort（9）、followup-suggest（4）、download-artifact（7）、history-stack（5）、artifact-drafts（7）、multi-artifact-scenarios（16）。
- 详细验收见 `docs/specs/competitor-driven-evolution-batch/checklist.md`；技术说明见 `docs/tech/artifact.md`。

---

# 商业化闭环批次（2026-10-26 晚间批次）

> 规格依据：`docs/specs/monetization-loop-batch/spec.md`。目标：让「盈利方式」看得见 —— 会员订阅 + 支付闭环打通 + 营收看板。

## 修复的付费链路硬伤（P0）

- **付费回跳 404**：支付适配器 callback 指向 `/unlock-result`，但前端路由表无此页面，用户付完钱落地 404。新增 `pages/unlockResult`（轮询查单 → paid 跳回预览页/首页，超时兜底文案），callback URL 增带 `orderId/kind/projectId` 上下文。
- **解锁后水印不消失**：`GET /project/:id` 的 `select` 未包含 `unlocked`/`userId`——付费解锁后预览页刷新仍拿到 `unlocked=undefined`，水印永不消失；且 `ensureProjectOwner` 因查不到 userId 形同虚设（任意登录用户可读任意项目信息）。修复：select 补两列，越权 403 真正生效。

## 后端交付

- **会员月卡**：`user.vip_expire_time` 列 + `vip_order` 实体（pending→paid 单向，同安全四原则）；`POST /billing/vip/order`（首月特惠 590 分/常规 990 分，`VIP_MONTH_PRICE_FEN`/`VIP_MONTH_FIRST_PRICE_FEN` 可覆盖）、`GET /billing/vip/order/:orderId`、`GET /billing/vip/status`；回调放行抽象 `dispatchPaidOrder`（unlock_order → vip_order 两表分发，幂等），会员 paid 后到期时间叠加 30 天（在期续费不丢剩余天数），记 `vip_pay` 增长事件。
- **会员权益**：quota 会员在期生成额度 `VIP_DAILY_GENERATE_LIMIT`（默认 30）+ 分享奖励，`DailyUsageView` 增 `vip/vipExpireTime`，429 hint 引导会员；全站免水印——`/project/:id` 与分享视图的 `unlocked` 输出升级为「项目已付费 || 归属人会员在期」，前端水印/导出链路零改动生效。
- **模拟支付通道**：适配器工厂（`PAY_CHANNEL=mock|xunhupay`，默认 xunhupay）+ `MockPayAdapter`（payUrl 指向站内 /mock-pay，HMAC-MD5 签名）+ `POST /billing/notify/mock`（验签后与真实通道同一 `dispatchPaidOrder` 语义）。三重闸门：PAY_CHANNEL 显式 = mock + MOCK_PAY_SECRET 已配置 + HMAC 验签；生产默认不可达。`order.channel` 改为取适配器名（mock 单对账一目了然）。
- **营收看板**：`GET /billing/admin/overview`（role=root，非 root 403）：今日/7 日/30 日三窗口解锁与会员的订单数 + GMV、累计付费用户去重、在期会员数、最近 20 笔订单。
- **分享页可选鉴权**：`viewShare` 识别合法 Bearer —— 归属人回传 `isOwner+projectId`（直达解锁），其余一律不回传（访客视角与旧版逐字节兼容）；引入 AuthModule 导出的 jwtModule + user 仓库。

## 前端交付

- **预览页付费中心**：解锁弹窗双 SKU 文案（单图 ¥1.9 首单 ¥0.9 / 会员 ¥9.9 首月 ¥5.9）、sponsor 态会员交叉销售入口、pay/sponsor 按订单类型区分文案与「首月特惠」标记；顶栏「会员·已解锁」标签（带到期日 tooltip）；AI 浮窗配额行加「会员」标识。
- **新页面**：`/unlock-result` 支付回跳（3s×20 轮询，paid 跳预览/首页）、`/mock-pay` 沙箱收银台（模拟支付成功 → POST mock 回调）、`/admin/revenue` 营收看板（三窗口 GMV 卡片 + 订单表，root 双层校验）。
- **分享页**：owner 打开自己分享链接 → 顶栏「解锁高清导出」直达预览页；未解锁访客底部前置「免费版带水印，¥1.9 解锁高清无水印」价值主张。
- **纯函数层**：`pages/preView/monetize.ts`（fenToYuan/formatVipExpire/parseUnlockResultQuery/describeOrderKind/windowGmvYuan），配 `monetize.check.ts` 13 用例。

## 接口与数据结构变更（增量）

- 新端点：`POST /billing/vip/order`、`GET /billing/vip/order/:orderId`、`GET /billing/vip/status`、`POST /billing/notify/mock`、`GET /billing/admin/overview`；`GET /share/view/:token` 响应新增可选 `isOwner/projectId`（仅 owner）。
- 数据库（生产需手工 DDL，开发 synchronize 自动）：`user` 加列 `vip_expire_time timestamp NULL`；新表 `vip_order`。
- env 新增：`VIP_MONTH_PRICE_FEN`/`VIP_MONTH_FIRST_PRICE_FEN`/`VIP_DAILY_GENERATE_LIMIT`/`PAY_CHANNEL`/`MOCK_PAY_SECRET`。
- 无既有接口签名破坏性变更；旧客户端对新增字段防御式读取。

## 红线

- 金额只信服务端（前端不传金额，回调金额不作放行依据）；回调必验签（MD5/HMAC）；mock 通道生产严禁开启（任何人可自我「支付」）；会员单幂等、unlock 单幂等语义不变；flowchart 兼容与配额口径不变。

## 测试与验收

- 后端：billing.service.spec 扩展（会员下单/回调续费叠加/幂等/mock 验签/看板聚合，套件 92 用例）、quota.service.spec 扩展（会员额度/过期回落/覆盖/降级）、project_share.service.spec 扩展（可选鉴权 5 用例）；全量 jest 回归绿（套件/用例数见 checklist）。
- 前端：monetize.check 13/13；全量 14 个 check 脚本绿（213 断言）；前后端 tsc 0 错误。
- 详细验收见 `docs/specs/monetization-loop-batch/checklist.md`。

---

# 付费转化增强批次（2026-10-27 凌晨批次）

> 规格依据：`docs/specs/monetization-conversion-batch/spec.md`。前置：商业化闭环批次。目标：把「看见链路」推进到「提升转化」—— 补齐 growth 一页纸挂账的导出水印预览、公开价格页与看板日趋势。

## 后端交付

- **看板日趋势**：`AdminRevenueOverview.dailyTrend`（近 14 天逐日 `{day, unlockGmvFen, vipGmvFen}`，订单表按 `update_time` 分日聚合、只计 paid，PG `GROUP BY` 输出列别名）；新增导出纯函数 `buildDailyTrend`（补齐缺日为 0，本地时区日期键与 startOfToday 同口径），raw 字符串金额/脏行按 0 容错。

## 前端交付

- **导出水印预览确认（growth §9.3 挂账需求落地）**：未解锁用户点「导出 PNG/SVG」先弹「导出预览」——水印效果示意 + ¥1.9 去水印 CTA（直达解锁动线）+「仍然带水印导出」（免费导出能力不剥夺，只前置价值感知）；已解锁/会员零改动。
- **公开价格页 `/pricing`**：免费/单图 ¥1.9（首单 ¥0.9）/会员 ¥9.9（首月 ¥5.9）三卡对比；会员卡登录态分流——未登录跳登录带 redirect 回流，已登录直接创建会员订单（pay/sponsor 分流 + 轮询 + paid 成功态，复用商业化闭环批次契约）；在期会员显示「续费」与到期日。
- **入口接线**：首页 TopLinks「价格」、分享页 footnote「价格 →」、预览页解锁弹窗 pay/sponsor 态「查看完整价格 →」。
- **看板柱状图**：`buildTrendView` 纯函数（按窗口最大单日总额归一化、最小可见高度 2%、MM-DD 标签）+ 纯 CSS 堆叠柱状图（上解锁/下会员，零图表依赖）。

## 接口变更（增量）

- `GET /billing/admin/overview` 响应新增 `dailyTrend` 字段（旧字段不变，前端防御式读取）。
- 新公开路由 `/pricing`。无破坏性变更、无数据库变更。

## 测试与验收

- 后端：billing.service.spec 新增 buildDailyTrend 两用例 + 看板 dailyTrend 断言；全量 jest 42 套件/447 用例全绿。
- 前端：monetize.check 13 → 17（buildTrendView 归一化/最小高度/标签/空数据四用例）；14 个 check 脚本 217 断言全绿；前后端 tsc 0 错误。
- 详细验收见 `docs/specs/monetization-conversion-batch/checklist.md`。

---

# 邀请裂变批次（2026-10-27 晨间批次）

> 规格依据：`docs/specs/invite-referral-batch/spec.md`。领导指令：不止修 bug，重点做产品功能与推广营销。本批把「发链接」升级成「发我的邀请链接」——增长一页纸新增获客引擎 D。

## 后端交付

- **邀请码体系**：`user` 新增 `invite_code`（8 位无歧义字符集，唯一索引；新用户 @BeforeInsert 自动生成，存量用户 /billing/invite/me 懒生成）与 `invited_by`（归因）；`ai_daily_usage` 新增 `invite_reward_count`（奖励日计数）。
- **注册归因 + 双向奖励**：CreateUserDto 可选 `inviteCode`（白名单 `^[A-Za-z0-9]{4,16}$`，非法静默忽略，注册永不因邀请码失败）；注册成功且码有效 → 落 invitedBy + `BillingService.applyInviteRewards`：邀请人会员 +1 天（`UPDATE WHERE < 3` 原子自增防并发超发，日上限 3 天）、被邀请人当日 +2 次生成（LEAST 3 封顶与分享奖励同池）、自邀请防御、`invite_register` 增长事件；归因/奖励全程旁路（内部吞错），失败不影响注册。
- **口径收敛**：会员顺延逻辑抽 `nextVipExpire`（回调续费与邀请奖励共用，杜绝两处算日期漂移）。
- **新端点** `GET /billing/invite/me`：邀请码 + 已邀请人数 + 会员态；`AdminRevenueOverview` 新增 `invitedUsers`（累计邀请注册）。
- UserModule imports BillingModule（exports BillingService），无循环依赖。

## 前端交付

- **`/invite` 活动页**（PrivateRoute）：专属邀请码大字展示 + 一键复制邀请链接 + 活动规则（口径与后端一致）+ 我的战果（已邀请 N 人 / 会员到期日）。
- **邀请码捕获**：`utils/channel.ts` 新增 `captureInviteCodeOnce`（?ic=/invite_code → localStorage，首次触达优先、白名单清洗）；main.tsx 入口调用。
- **注册页**：新增「邀请码（选填）」输入框（?ic= 自动回填），随注册请求提交。
- **入口接线**：首页 TopLinks「邀请有礼」、价格页底部裂变入口；营收看板新增「累计邀请注册」卡片。
- **纯函数**：`monetize.ts` 新增 `sanitizeInviteCode`/`buildInviteLink`（与后端 invite.ts 同白名单口径）。

## 接口与数据结构变更（增量）

- 新端点：`GET /billing/invite/me`；注册请求新增可选 `inviteCode` 字段；`/billing/admin/overview` 响应新增 `invitedUsers`。
- 数据库（生产手工 DDL 见 deployment 手册）：`user` 加 `invite_code varchar(16) NULL`（唯一索引）+ `invited_by varchar(16) NULL`；`ai_daily_usage` 加 `invite_reward_count int NOT NULL DEFAULT 0`。
- 无破坏性变更；旧客户端不带 inviteCode 照常注册。

## 红线

- 奖励是旁路（吞错不阻断注册）；金额/天数只在服务端计算；日上限 3 天 + 注册 IP 限流防刷；自愿激励无强制话术。

## 测试与验收

- 后端：billing.service.spec 新增 applyInviteRewards 四用例（有效邀请/日上限已满/自邀请/异常旁路）+ getInviteHome 两用例（懒生成/已有码）；user.service.spec 新增邀请归因三用例（有效归因+奖励调用/非法忽略/旁路失败注册仍成功）；全量 jest 绿（数字见 checklist）。
- 前端：monetize.check 17 → 21（邀请码白名单/trim/链接生成/坏输入四用例）；全部 check 脚本绿。
- 详细验收见 `docs/specs/invite-referral-batch/checklist.md`。

---

# 留存与裂变加强批次（2026-10-27 上午批次）

> 规格依据：`docs/specs/retention-invite-plus-batch/spec.md`。两个钩子：每日签到（留存 → 会员体验 → 付费转化）+ 阶梯邀请里程碑（裂变冲榜）。

## 后端交付

- **每日签到**：新表 `daily_checkin`（(userId,day) 唯一兜底幂等，streak 连续天数）；`POST /ai/checkin`（当日首次 → streak 计数 + 额度 +1 同池 LEAST 3；**连签每满 7 天整数倍 → 会员 +1 天**，`checkin_vip` 事件；重复签到幂等；落库冲突按并发重复处理）；`GET /ai/checkin` 状态查询。新目录 `ai/checkin/`（CheckinController/Service），AiModule 注册并 imports BillingModule。
- **阶梯邀请里程碑**：`INVITE_MILESTONES`（3 人 +3 天 / 10 人 +7 天，改常量即调档）；新表 `invite_milestone`（(userId,milestone) 唯一）；`applyInviteRewards` 内自动发放——先守卫 `invitedCount >= count` 再 `INSERT ON CONFLICT DO NOTHING RETURNING` 抢占（防并发重复），实现期自查修掉「未守卫先插表」缺陷并有回归用例；`grantVipDays` 公开方法成为运营侧会员天数发放统一入口（签到/里程碑共用，顺延口径统一 nextVipExpire）；`/billing/invite/me` 返回 `milestones` 进度。

## 前端交付

- **浮窗签到**：配额栏新增「签到 +1」按钮（已签显示「已连签 N 天」），签到成功即时刷新额度，连签满 7 天弹「会员 +1 天」提示；试用态不展示。
- **邀请页里程碑**：进度条（累计 N 人 / +X 天会员 / 已发放），规则文案同步两档里程碑。

## 接口与数据结构变更（增量）

- 新端点：`GET/POST /ai/checkin`（JWT）；`/billing/invite/me` 响应新增 `milestones`。
- 数据库（生产手工 DDL 见 deployment 手册 ⑦）：新表 `daily_checkin`、`invite_milestone`。
- 无破坏性变更。

## 红线

- 签到/里程碑奖励全部旁路（吞错不阻断主链路）；连签周期与里程碑档位只改常量；每日奖励同池封顶（bonus_generate ≤3）防止无限白嫖额度。

## 测试与验收

- 后端：新增 checkin.service.spec（6 用例：首签/幂等/连签满 7 天/断签重置/旁路容错/状态查询）；billing.service.spec 新增里程碑 3 用例（跨档发放一次/已领取不重复/未达档不触碰）+ getInviteHome 进度 2 用例；全量 jest **43 套件/466 用例全绿**。
- 前端：全部 check 脚本 0 失败；前后端 tsc 0 错误。
- 详细验收见 `docs/specs/retention-invite-plus-batch/checklist.md`。

---

# 社区模板批次（2026-10-27 上午批次之二）

> 规格依据：`docs/specs/community-template-batch/spec.md`。目标：用户作品变成获客长尾 —— 模板中心从「官方 20 条」扩展为「官方 + 社区精选」，投稿者获署名曝光（第三条自驱动机，与签到/邀请并列）。

## 后端交付

- **投稿**：`POST /template/submit/:projectId`（JWT + 归属校验 404；projectId 唯一防灌水 400）；自动确保成品可看——查 project_share 复用既有 token、无则直建，**刻意不走 ProjectShareService.createShare（其首次创建发分享奖励，投稿触发奖励=套利漏洞），不记 share_create**；status=pending + `community_submit` 增长事件。
- **审核**：`GET /template/community/pending` + `POST /template/community/review/:id`（均 root 校验 403；pending → approved/rejected 单向，已处理再审 404）——UGC 必审后上架的合规闸门。
- **公开列表**：`GET /template/community`（限流守卫）：仅 approved ≤24 条倒序。
- TemplateModule 从纯静态扩为静态 + 三仓库（community_template/project/project_share），官方模板零改动。

## 前端交付

- **投稿动线**：预览页工具栏「投稿模板」→ 弹窗（描述选填，标题取项目名）→ 提示「审核通过后展示」。
- **模板中心「社区精选」分区**：approved 卡片（标题/署名/描述）+「查看成品」跳 `/share/:token`（免登录看图，页内复制/注册动线零成本复用）；空/失败时分区整体隐藏，不影响官方模板主区。
- **营收看板「社区模板待审」卡片**：root 通过/拒绝一键操作，完成即从列表移除。

## 接口与数据结构变更（增量）

- 新端点：`POST /template/submit/:projectId`、`GET /template/community`、`GET /template/community/pending`、`POST /template/community/review/:id`。
- 数据库（生产手工 DDL ⑧）：新表 `community_template`（projectId 唯一 + status 索引）。

## 红线

- UGC 必审后上架；投稿不发分享奖励（套利防御）；归属校验 404 防枚举；审核操作仅 root。

## 测试与验收

- 后端：template.service.spec 新增 5 用例（归属 404/投稿成功含代建分享/重复投稿 400/既有分享复用/审核流转与公开列表口径）；全量 jest **43 套件/471 用例全绿**。
- 前端：全部 check 0 失败；前后端 tsc 0 错误。
- 详细验收见 `docs/specs/community-template-batch/checklist.md`。

---

# 会员到期提醒批次（2026-10-27 午间批次）

> 规格依据：`docs/specs/vip-renewal-reminder-batch/spec.md`。连签/邀请赠送的会员体验期结束时的「额度落差」（30 次/日 → 3 次/日）是天然付费窗口，本批把提醒做出来。

- **后端**：`VipStatusView` 新增 `daysLeft`（在期剩余整天数 ceil ≥1，续费提醒的服务端唯一口径）。
- **前端浮窗**：配额栏会员 chip 剩 ≤3 天（`VIP_RENEWAL_WINDOW_DAYS`）切警示样式「N 天后到期 · 续费」，点击直达 `/pricing`；价格页会员卡显示剩余天数与顺延规则。
- **纯函数**：`vipDaysLeft`/`vipRenewalText`（monetize.ts，ceil 语义 + 空值容错），monetize.check 21 → 24。
- 验证：全量 jest 43 套件/471 用例绿；前端 check 0 失败；tsc×2 干净。详见 `docs/specs/vip-renewal-reminder-batch/checklist.md`。

---

# 分享归因批次（2026-10-27 午间批次之二）

> 规格依据：`docs/specs/share-attribution-batch/spec.md`。补齐 growth 一页纸 §9.2 挂账的「分享浏览 → 注册」归因盲区：分享裂变从总量可见升级为单链接可归因。

- **前端**：分享页落地成功 → `markShareSource(token)` 写 localStorage（32 位 hex 白名单、首次触达优先）；注册请求随带 `shareToken`（utils/channel 新增 markShareSource/readShareSource）。
- **后端**：注册 DTO 新增可选 `shareToken`（service 层 `^[0-9a-f]{32}$` 白名单，非法静默忽略）；`register` 增长事件携带 shareToken —— 与 share_view 按 token join，单条分享链接的注册转化可从日志直接取数（`grep share_view` × `grep register` 按 token 对账）。
- **归因体系现状**：渠道（ch=）＋ 邀请人（ic=）＋ 分享链接（shareToken）三路独立归因，互不覆盖。
- 验证：全量 jest 43 套件/473 用例绿（净增 2）；前端 check 0 失败；tsc×2 干净。详见 `docs/specs/share-attribution-batch/checklist.md`。

---

# 模板使用统计批次（2026-10-27 午间批次之三）

> 规格依据：`docs/specs/template-usage-stats-batch/spec.md`。给社区模板装上「热度仪表」——投稿激励与热度排序的数据基础。

- **计数**：`community_template` 加 `view_count/copy_count`；viewShare 成功 → view_count +1，duplicateShare 成功 → copy_count +1（按 shareToken 命中，raw SQL 原子自增，旁路静默——统计绝不阻断查看/复制主链路；普通分享 token 无命中行零成本）。
- **口径**：`GET /template/community` 返回 viewCount/copyCount，社区精选按复制数降序 → 时间降序（热门优先）——被复制是最强使用意图信号。
- **前端**：社区卡片显示「N 次查看 · M 次复制」。
- 验证：全量 jest 43 套件/476 用例绿（净增 3）；前端 check 0 失败；tsc×2 干净。详见 `docs/specs/template-usage-stats-batch/checklist.md`。

---

# CTA 点击埋点补全（2026-10-27 午间批次之四）

> 目标：补全增长漏斗最后一段可测点位 —— 社区模板卡片点击。

- `community_template_click` 进客户端事件白名单（growth-track.controller）；模板中心社区卡片点击上报 templateId，与 share_view/share_duplicate（均带 token）串成完整转化漏斗：**click → view → duplicate**。
- 验证：observability spec 40 用例绿（新增白名单用例）；全量 jest 43 套件/477 用例绿（净增 1）；前端 check 0 失败；tsc×2 干净。

---

# 投稿激励批次（2026-10-27 下午批次）

> 规格依据：`docs/specs/community-reward-batch/spec.md`。把「投稿」从荣誉激励升级为收益激励 —— 作品被复制跨档自动送投稿人会员天数。

- **常量**：`COMMUNITY_COPY_MILESTONES`（被复制 5 次 +1 天 / 20 次 +3 天，template/community-rewards.ts，改常量即调档）。
- **发放链路**：duplicateShare 复制计数改为 `UPDATE ... RETURNING copy_count, owner_id` 原子读回 → 跨档且未领取过（`template_copy_reward` 表 INSERT ON CONFLICT DO NOTHING 抢占防并发重复）→ `grantVipDays`（事件 `community_copy_milestone`）。全程旁路：fire-and-forget 微任务链不阻塞复制响应，发放失败只留痕。
- **模块**：ProjectShareModule imports BillingModule（grantVipDays）+ forFeature TemplateCopyRewardEntity；无循环依赖。
- 验证：全量 jest 43 套件/481 用例绿（净增 4）；tsc 0 错误。详见 `docs/specs/community-reward-batch/checklist.md`。

---

# 会员到期横幅批次（2026-10-27 下午批次之二）

> 目标：续费双触点闭环（浮窗 chip + 首页横幅），并新增「已到期唤醒」场景。

- **后端**：`VipStatusView` 新增 `expiredDays`（已过期整天数，唤醒口径）；`vipExpireTime` 改为「从未开通才为 null」（历史会员过期也回传）。
- **前端**：共享组件 `VipExpiryBanner` 挂已登录首页顶部 —— 在期剩 1 天 →「明天到期·立即续费」；已过期 ≤7 天 →「额度已回落·恢复会员权益」（流失超 7 天不打扰）；旁路拉取失败静默隐藏。
- 验证：全量 jest 43 套件/481 用例绿（getVipStatus 三态断言重写）；前端 check 0 失败；tsc×2 干净。详见 `docs/specs/vip-expiry-banner-batch/spec.md`。

---

# 投稿者数据面板批次（2026-10-27 下午批次之三）

> 目标：投稿激励的反馈闭环可视化 —— 投稿者在邀请页看到「我的社区作品」审核状态与热度。

- **后端**：`GET /template/community/mine`（JWT）：本人全部投稿（title/status/viewCount/copyCount/shareToken），按时间倒序 ≤50 条 —— template.service.listMyCommunity。
- **前端**：`/invite` 页新增「我的社区作品」卡片（审核中/已上架/已驳回 + N 查看 · M 复制 + 激励规则提示）；旁路查询失败隐藏分区。
- 验证：全量 jest 43 套件/482 用例绿（净增 1）；前端 check 0 失败；tsc×2 干净。
