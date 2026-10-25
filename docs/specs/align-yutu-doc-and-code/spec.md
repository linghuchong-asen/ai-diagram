# 语图文档与代码全量对齐 Spec

## Why

语图技术方案文档（`projectDemo/docs/ai-tech/`，14 篇）定义了完整的 Agent 架构与实现规则，但 `ai-diagram` 项目的实际实现与文档存在系统性落差：前端 **FlowDraft→X6 转换层、四级降级匹配、新节点布局、人在回路 UI 全部为 0% 实现**，AI 浮窗甚至是未挂载到路由的死代码；后端 LangGraph/pgvector/Langfuse/Redis/tsvector 均缺失或整体注释，工具重试、滚动摘要、长期记忆 embedding、遗忘扫描、Token 配额、鉴权与 CORS 白名单等文档规则未落地。结果是「AI 对话生成流程图」这条核心链路在真实环境中跑不通，文档也无法作为可信的实现基准。

## What Changes

### 阶段一：补齐缺失代码（P0 → P1 → P2 优先级顺序）

**P0 · 打通「对话生成/修改 → 画布渲染」核心链路（前端）**
- 新建 FlowDraft→X6 转换层，按文档 `NODE_TYPE_CONFIG` 实现 6 种语义节点（start/end 椭圆 120×50、process 圆角矩形 140×50、decision 菱形 `refPoints:'0,40 70,0 140,40 70,80'`、io 平行四边形 `refPoints:'20,0 140,0 120,50 0,50'`、subprocess 双线框）+ `PORT_GROUPS` 四向端口 + 端口方向约定（start 仅 bottom、end 仅 top）+ `toX6Node/toX6Edge`。
- 新建程序化自动布局（分层拓扑 + 矩形碰撞检测 + 间距约束），替代文档声称但未安装的 `@antv/layout`。
- 实现**增量修改四级降级匹配**：L1 id 精确 → L2 语义(label+type) → L3 拓扑(前后继签名) → L4 边校验兜底，产出 `MatchLevel` 与未匹配残差清单。
- 实现**新节点定位**：相连节点质心初始位置 → 矩形碰撞检测 → 先下后右步进偏移。
- 实现**选择性应用**：按操作项逐条可勾选，未匹配项显式提示而非静默丢弃。
- 把 AI 浮窗挂载进 X6 编辑器页面组件树，打通 `canvas/sessionId/projectId` 三要素传参，使 modify 意图真正可用。
- 实现人在回路确认 UI（模糊语义/低置信匹配 → 卡片式确认 → 回传后端恢复执行）。
- 统一 SSE 协议：单一 SSE 客户端封装，字段与后端 `ThinkSseEvent` 对齐，携带 Authorization，覆盖超时/异常/卸载的连接关闭。

**P0 · 后端主链路补齐**
- 意图识别**模型兜底真正落地**（规则未命中/歧义/多命中时调用 medium 模型 + `INTENT_SYSTEM_PROMPT`，输出受 Zod 约束）。
- `toolRegistry` **接入主链路**：工具白名单、入口参数 Zod 校验、结果归一化、结构化错误（不泄原始堆栈）、`context_id` 多轮工具上下文、结果封顶（top-K + 字段白名单）。
- 工具失败分级重试循环：network → 代码指数退避 ≤3 次；param → 模型自修正 ≤3 次；耗尽 → System Prompt 受控降级话术。
- 反思校验补**环检测**（文档「未闭环」规则），Evaluator/Rewriter/Controller 三层闭环。
- 流式链路收尾：`ThinkStreamHub.end()` 全路径调用、`ThreadStore.cleanupOlderThan` 定时清理（修内存泄漏）。

**P1 · 记忆体系与上下文**
- 滚动摘要（每 2 轮）落地，接入现有 `conversation_summaries` 表；短期 Checkpointer 抽象为可切换实现（内存 / PG 表）。
- 长期记忆双路召回补齐向量路：以**可插拔 Embedding Provider** 实现（默认走 LLM adapter 的 embedding 接口；无 key 时自动退化为纯摘要+关键词路并显式记录降级），RRF 融合 + top-N。
- 遗忘曲线接定时器（每周扫描，`weight=exp(-0.693*days/halfLife)`，>0.5 保留 / 0.3~0.5 再压缩 / <0.3 删除）。
- 上下文组装按文档占比（记忆 40% / 项目 20% / 用户输入 15% / 工具结果 10% / system 10% / 工具定义 5%）做**分段预算截断**，总量卡 80% 上限。
- 实体保真（sessionEntitySlot）与话题切换检测（相似度阈值）落地。

**P1 · 安全与稳定性**
- 启用 `JwtAuthGuard`：project/editor/ai 路由全量鉴权 + `projectId` 归属校验（数据隔离）。
- 令牌态存储接线：Redis 可用则用 Redis，否则落 PG 令牌表（可开关，默认无 Redis 也可运行）。
- 配置加固：移除 `'sk-xxx'` 兜底（缺失即启动期显式失败并给出指引）、JWT secret 强制环境变量、`synchronize` 受环境开关控制、**CORS 改为白名单**（拒绝 `*`）。
- Token 成本三级防护：用户级每日配额（generate/modify 分开计量）、会话级软上限提示、调用级 `max_tokens` 硬上限 + 超长截断触发反思重试。
- Prompt 注入防御：输入预处理关键词/模式过滤 + System Prompt 首尾角色锚定。
- 启用 PG `tsvector + GIN` 全文检索（search 模块接线，零新依赖），Ctrl+K 检索打通。
- 修复既有缺陷：`project_manager.service.ts` 月份 `getMonth()` 未 +1、`user.service.ts` 头像路径 `split('\\')` 跨平台失效、`http.ts` 错误被 `JSON.stringify` 成 `"{}"`、ConfigNode/ConfigEdge 属性 key 写错、快捷键与事件监听器重复绑定/泄漏、缩放百分比逻辑错误、画布尺寸固定 1920×1080 不自适应。

**P2 · 可观测与质量**
- 内置轻量 trace：按 threadId 记录意图→上下文→工具→生成→反思全轨迹（步骤、耗时、token、异常），落 PG 并可查询；不引入 Langfuse 依赖。
- 评估脚本：固定用例集回归，输出格式合规率 / 图结构完整性 / 意图识别准确率 / 工具调用成功率统计（统计而非断言）。
- 补关键单测（转换层、四级匹配、布局碰撞、图校验、意图规则、错误分类、遗忘曲线），替换空脚手架 `*.spec.ts`。
- 清理孤儿代码：`utils/sse.ts`、`schemas/flow.schema.ts`、`schemas/ai_response.schema.ts`、`node_types.tsx` 的 `loadNode`、`toolBar.tsx` 的 `isSave` 死逻辑等（**删除前逐项征得用户同意**）。

### 阶段二：文档与代码双向对齐
- 以 `git checkout origin/master -- docs/ai-tech` 将 14 篇文档提取到 `projectDemo/docs/ai-tech/`（纯新增文件，不回滚任何本地改动），原地修订。
- 逐篇校验并修订：技术选型版本表（React 17 / X6 v1.31 / vite 2 / antd 4 / NestJS 10）、LangGraph → 「轻量状态机（语义对齐 LangGraph，可平滑迁移）」、pgvector/Langfuse/@antv/layout → 标注为「演进项」并写明当前等价实现、Redis → 「可选，缺省 PG 令牌表」、补模板匹配短路等文档未记录的实际行为。
- 补齐缺失的使用说明、边界规则（空输入/超长输入/环图/多命中意图/工具全失败/配额耗尽/SSE 断连）、部署指引（环境变量清单、Docker 多阶段构建、上线检查清单、回滚四类）。
- 文档定稿后做**全量代码走查**：冗余逻辑、性能问题（N+1 查询、无界数组、重复渲染、监听器泄漏）、不规范写法、未做异常处理的场景，逐项修复。

### 阶段三：产品功能建议报告
- 调研同类主流产品（AI 图表生成 / 语图可视化方向）核心功能、特色能力、痛点解决方案。
- 输出结构化建议清单，每条含：功能点描述、用户价值、实现难度评估、预期收益，并标注与现有能力基础的衔接点与落地顺序。

### 交付物
1. 代码补齐优化后的完整可运行项目包（前端 + 后端）
2. 优化后的最新版语图文档（`projectDemo/docs/ai-tech/`）
3. 代码迭代变更说明文档（`.trae/specs/align-yutu-doc-and-code/` 下）
4. 完整的产品功能建议报告（`.trae/specs/align-yutu-doc-and-code/` 下）
5. 全量功能验证记录

### 关键决策（避免实现阶段摇摆）
- **不引入新基础设施依赖**：pgvector、Langfuse、Redis、@antv/layout、ES 一律不作为硬依赖；以「PG 原生能力 + 内置轻量等价实现 + 可插拔 Provider」落地，文档中相应表述改为「当前实现 / 演进项」分层。
- **文档以代码为最终真源**：凡文档与实现冲突且实现合理者，改文档；凡文档规则属核心语义（四级匹配、节点映射、布局规则、反思校验、SSE 协议、错误分类）者，改代码。
- **不回滚用户本地任何改动**；批量删除文件前逐项征得同意。

## Impact

- **Affected specs**: 无既有 spec（本次为首个规格）
- **Affected code（前端 `frontend/`）**：
  - 新增 `src/pages/ai/transform/`（FlowDraft→X6 转换层、NODE_TYPE_CONFIG、PORT_GROUPS）
  - 新增 `src/pages/ai/layout/`（程序化布局、碰撞检测、质心定位、步进偏移）
  - 新增 `src/pages/ai/match/`（四级降级匹配、选择性应用）
  - 改造 `src/pages/ai/ai_float_window.tsx`（挂载、传参、operations 应用、人在回路 UI、SSE 统一）
  - 新增 `src/utils/aiClient.ts`（chat/think/result 三接口统一封装，携带鉴权）
  - 改造 `src/pages/x6Editor/index.tsx`、`components/toolBar.tsx`、`components/configPanel/*`、`src/utils/hooks/useGraph.tsx`、`src/utils/http.ts`、`src/router/routes.tsx`
- **Affected code（后端 `serverend/`）**：
  - 改造 `src/ai/agents/graph.ts`、`state.ts`（工具节点接入、人在回路中断/恢复）
  - 改造 `src/ai/intent/*`（模型兜底）、`src/ai/reflection/*`（环检测）、`src/ai/tools/*`（重试循环、错误结构化、参数校验）
  - 改造 `src/ai/memory/*`（滚动摘要、embedding provider、遗忘定时器）、`src/ai/context/*`（分段预算）
  - 改造 `src/ai/streaming/*`（end 调用、定时清理）、`src/ai/adapters/llm.factory.ts`（key 校验、embedding）
  - 改造 `src/app.module.ts`、`src/main.ts`（模块接线、CORS 白名单、synchronize 开关）
  - 改造 `src/auth/*`（JwtAuthGuard 启用、令牌态存储）、`src/project-manager/*`、`src/editor/*`（归属校验、月份 bug）
  - 新增 `src/observability/*`（轻量 trace）、`src/search/*` 接线（tsvector + GIN）
- **Affected docs（`projectDemo/docs/ai-tech/`）**：14 篇 md 全量修订 + sidebar/navbar 配置核对
- **新增交付文档**：代码迭代变更说明、产品功能建议报告（置于本 spec 目录）

## ADDED Requirements

### Requirement: FlowDraft 到 X6 的确定性转换层
系统 SHALL 提供纯函数式转换层，把后端返回的 FlowDraft（仅含 nodes/edges 的 id/label/type 语义字段）确定性地映射为 X6 可渲染的图数据，模型永不输出坐标、样式与 ports。

#### Scenario: 生成意图渲染成功
- **WHEN** 用户输入「画一个请假审批流程」且后端返回合法 FlowDraft
- **THEN** 画布按 6 种语义节点映射规则渲染（start/end 椭圆、process 圆角矩形、decision 菱形、io 平行四边形、subprocess 双线框），端口按四向 PORT_GROUPS 生成，start 仅暴露 bottom 端口、end 仅暴露 top 端口，节点位置由程序化布局计算且互不重叠

#### Scenario: 非法或缺失类型降级
- **WHEN** FlowDraft 中某节点 type 缺失或不在 6 种枚举内
- **THEN** 该节点降级为 process 样式渲染，并在界面提示降级项，不抛异常、不中断整图渲染

### Requirement: 增量修改四级降级匹配
系统 SHALL 在应用 modify 操作前，对每个目标节点依次执行 L1 id 精确匹配 → L2 语义匹配（label+type）→ L3 拓扑匹配（前驱/后继签名）→ L4 边校验兜底，并记录命中层级 `MatchLevel`。

#### Scenario: 模型漏写 ID 不误删
- **WHEN** modify 操作未携带目标节点 id，但该节点 label 与 type 与画布中唯一节点一致
- **THEN** 系统在 L2 命中并完成修改，画布上未涉及的节点（含用户手动调整的坐标）保持原样

#### Scenario: 全部层级未命中
- **WHEN** 某操作项在 L1~L4 均未匹配到画布元素
- **THEN** 该项进入「未匹配残差清单」并在 UI 显式列出，用户可选择忽略或手动指定目标，系统绝不静默丢弃、绝不误删既有节点

### Requirement: 新节点定位与碰撞规避
系统 SHALL 为新增节点计算初始位置：取其相连节点坐标质心，做矩形碰撞检测，冲突时按「先向下、再向右」的固定步进偏移直到无重叠。

#### Scenario: 在密集区域插入节点
- **WHEN** 新增节点的相连节点周围已被其他节点占据
- **THEN** 新节点沿先下后右方向逐格偏移，最终位置与画布上所有既有节点包围盒无重叠，且不改变任何既有节点坐标

### Requirement: 选择性应用与人在回路确认
系统 SHALL 支持对 AI 返回的操作列表逐条勾选应用，并在语义模糊或匹配置信度低时中断执行、请求用户确认后再恢复。

#### Scenario: 模糊语义触发确认
- **WHEN** 反思层判定分支标签存在歧义（如「审批通过」可对应多个决策出口）
- **THEN** 前端弹出确认卡片列出候选项，用户选择后请求携带确认结果回到后端恢复执行，未确认前画布不发生任何变更

### Requirement: 统一 SSE 与结果拉取协议
系统 SHALL 通过单一封装完成 `POST /ai/chat` → `SSE /ai/think/:threadId` → `GET /ai/result/:threadId`（202 轮询）三段式调用，事件字段与后端 `ThinkSseEvent`（thinking|done|error）严格一致，所有请求携带 Authorization。

#### Scenario: 连接异常与超时
- **WHEN** SSE 触发 error 事件、连接中断或结果轮询超过超时阈值
- **THEN** 前端关闭 EventSource 与轮询定时器、向用户展示可读错误、清理 thread 状态，不产生悬挂连接与内存泄漏

### Requirement: 工具调用适配层与失败分级重试
系统 SHALL 让所有工具经统一出口调用：白名单校验、入口参数 Zod 校验、结果归一化与封顶（top-K + 字段白名单）、错误结构化脱敏；失败按类型分级处理。

#### Scenario: 网络类失败代码重试
- **WHEN** 工具执行抛出网络类错误
- **THEN** 由代码按指数退避重试至多 3 次，不把原始堆栈交给模型；重试成功则正常继续链路

#### Scenario: 参数类失败模型自修正
- **WHEN** 工具参数校验失败
- **THEN** 系统将结构化错误摘要（`message_for_llm`）回传模型自修正，至多 3 次；仍失败则按 System Prompt 预设话术降级，回复中不含内部 IP、连接串、文件路径等敏感信息

### Requirement: Token 成本三级防护
系统 SHALL 在用户级（每日配额，generate/modify 分开计量）、会话级（软上限提示）、调用级（max_tokens 硬上限）三层管控 Token 消耗。

#### Scenario: 配额耗尽
- **WHEN** 用户当日 Token 配额已用尽
- **THEN** 系统拒绝新的生成/修改请求并返回明确提示，或按配置降级到更小模型，绝不无限制继续调用

### Requirement: 全量鉴权与数据隔离
系统 SHALL 对 project / editor / ai 路由启用 JWT 鉴权，并在文档与项目查询时校验当前用户对 `projectId` 的归属权限；记忆按 `project_id`、画像按 `user_id` 命名空间隔离。

#### Scenario: 越权访问被拒
- **WHEN** 用户 A 携带自身 token 请求用户 B 的项目文档
- **THEN** 返回 403，且不泄露该文档是否存在

### Requirement: 内置轻量执行轨迹（trace）
系统 SHALL 按 threadId 记录一轮会话的完整执行轨迹（各步骤输入输出摘要、耗时、token 消耗、异常信息），持久化并可查询，用于问题定位与轨迹评估。

#### Scenario: 定位低效轨迹
- **WHEN** 某次生成的流程图质量差
- **THEN** 可按 threadId 查到该轮的工具调用次数、反思回路次数与失败原因，判断属规划、记忆还是工具问题

### Requirement: 回归评估脚本
系统 SHALL 提供固定用例集回归脚本，输出格式合规率、图结构完整性、意图识别准确率、工具调用成功率的统计结果（统计而非硬断言），并支持 Bad Case 对比。

#### Scenario: 发版前跑闸门
- **WHEN** 执行回归脚本
- **THEN** 输出各维度指标与未通过用例明细，格式合规率非 100% 或核心组件指标跌破阈值时明确标红提示不可发布

## MODIFIED Requirements

### Requirement: 意图识别两级策略
系统 SHALL 先走规则识别（动词特征 + 上下文状态），命中即零模型成本路由；当无动词特征、存在歧义或多规则命中时，SHALL 调用模型兜底并给出真实 `intentSource='llm'`（当前实现仅标注 llm 却未调用模型，属虚假来源标记，需修正）。

#### Scenario: 歧义输入走模型
- **WHEN** 用户输入「这个流程再改一下」且上下文不足以判定 generate/modify/consult
- **THEN** 调用 medium 模型分类，输出经 Zod 校验后写入 state，`intentSource` 如实标记为 llm，并计入 token 统计

### Requirement: 图结构反思校验
系统 SHALL 在 Zod 格式校验之外执行图遍历结构校验，覆盖：缺失 start/end、非法 type、id 不唯一、边引用不存在节点、节点无输出分支、决策节点无分支、不可达节点，并**新增环检测**以落实文档「未闭环」规则。

#### Scenario: 检出环路
- **WHEN** 生成的流程图存在非预期环路
- **THEN** 校验器产出对应 issue，Rewriter 局部修正且不重走主生成流程，重试上限 2 次，超限则交用户确认

### Requirement: 记忆分层与召回
系统 SHALL 保持短期（Checkpointer）/长期（Store）/画像三层分离：每 2 轮滚动摘要、每 10 轮或会话结束异步写长期记忆；召回时先评估短期 trim 3 轮是否够用，不够再走长期双路召回（向量 + 摘要）经 RRF 融合取 top-10、Reranker 取 top-3。向量路 SHALL 通过可插拔 Embedding Provider 实现，Provider 不可用时自动退化为单路并记录降级原因（当前实现向量路恒为空，属未落地）。

#### Scenario: 无 embedding 能力时可用
- **WHEN** 部署环境未配置 embedding 接口
- **THEN** 长期召回退化为摘要 + 关键词单路，功能不中断，trace 中记录降级标记

### Requirement: 存储层统一
系统 SHALL 以 PostgreSQL 单库承担关系数据、JSONB 文档、`tsvector + GIN` 全文检索；Redis 为**可选**依赖，用于令牌态与缓存，缺省时令牌态落 PG 表（当前 Redis 与 search 模块整体注释，需接线或明确降级）。语义检索按「当前实现 / 演进项（pgvector）」分层表述。

#### Scenario: 无 Redis 环境启动
- **WHEN** 未配置 Redis 连接
- **THEN** 后端正常启动，鉴权走 PG 令牌表，登出与主动失效仍生效

### Requirement: 前端节点体系
系统 SHALL 使编辑器 Stencil 面板与画布节点体系统一到文档定义的 6 种流程图语义类型（当前面板为 image shape + SVG 图片资源，与语义类型完全脱节，需改造为语义节点库）。

#### Scenario: 拖拽新增语义节点
- **WHEN** 用户从面板拖入「决策」节点
- **THEN** 画布生成菱形决策节点并带四向端口，其配置面板可编辑 label 与分支，保存后 JSONB 中记录的是语义结构而非图片引用

## REMOVED Requirements

### Requirement: 以 LangGraph / pgvector / Langfuse / @antv/layout / Redis / ES 作为硬依赖
**Reason**: 上述能力在当前代码库中完全不存在或整体注释，作为硬依赖会阻断「可正常运行无核心报错」这一交付底线，且引入不可控的基础设施与环境要求。
**Migration**: 保留其语义等价实现——LangGraph → 手写轻量状态机（已声明遵循 LangGraph 语义、可平滑迁移）；pgvector → 可插拔 Embedding Provider + 退化单路；Langfuse → 内置轻量 trace 落 PG；@antv/layout → 自研程序化布局（质心 + 碰撞检测 + 步进偏移，本就是文档描述的规则）；Redis → 可开关，缺省 PG 令牌表；ES → PG tsvector 全文检索。文档中相应表述统一改为「当前实现 / 演进项」分层写法，不删除设计意图。

### Requirement: 前端 AI 浮窗的内联 SVG 预览作为唯一预览形态
**Reason**: 内联 SVG 预览与 X6 画布脱节，无法体现真实渲染效果，且层数多时横向重叠、有环图仅靠 guard 保护。
**Migration**: 预览改为复用 FlowDraft→X6 转换层 + 程序化布局渲染到只读 X6 画布，保留原有拓扑分层算法作为布局输入；删除重复的内联 SVG 布局代码（删除前征得用户同意）。
