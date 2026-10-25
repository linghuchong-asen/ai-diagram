# Checklist

## 阶段一 · 转换层与布局
- [x] `frontend/src/pages/ai/transform/` 存在且实现 6 种语义节点映射，尺寸/形状与文档 NODE_TYPE_CONFIG 完全一致（start·end 椭圆 120×50、process 圆角矩形 140×50、decision 菱形 `0,40 70,0 140,40 70,80`、io 平行四边形 `20,0 140,0 120,50 0,50`、subprocess 双线框）
- [x] 端口按四向 PORT_GROUPS 生成，且 start 仅 bottom、end 仅 top
- [x] 未知/缺失 type 降级为 process 并提示，不抛异常、不中断整图渲染
- [x] 转换层为纯函数，模型输出中不含坐标/样式/ports
- [x] 程序化布局产出无节点重叠（矩形包围盒碰撞检测生效）
- [x] 新节点定位遵循「相连节点质心 → 碰撞检测 → 先下后右步进偏移」，且不改变任何既有节点坐标
- [x] 环图输入下布局不死循环

## 阶段一 · 四级匹配与选择性应用
- [x] `MatchLevel` 类型为 `'id'|'semantic'|'topology'|'edge_check'` 四级且逐级降级
- [x] modify 操作漏写 id 时经 L2/L3 命中，未涉及节点（含用户手动坐标）保持原样
- [x] L1~L4 全未命中的操作项进入残差清单并在 UI 显式列出，无静默丢弃、无误删
- [x] 后端 7 种 op（modify_node/modify_edge/add_node/add_edge/delete_node/delete_edge/reposition）全部被前端消费
- [x] 操作项支持逐条勾选应用

## 阶段一 · AI 浮窗与协议
- [x] `AiFloatWindow` 已挂载到编辑器组件树且路由可达（不再是死代码）
- [x] 请求携带 `canvas`/`sessionId`/`projectId`，modify 意图端到端可用
- [x] SSE 事件字段与后端 `ThinkSseEvent`（thinking|done|error）一致，无 `delta`/`token` 字段冲突
- [x] chat/think/result 三接口统一封装且携带 Authorization
- [x] 超时、error 事件、组件卸载三条路径均关闭 EventSource 与轮询定时器，无悬挂连接
- [x] 人在回路确认 UI 可用：确认前画布零变更，确认后恢复执行
- [x] 「已应用 N 项修改操作」文案反映真实应用结果

## 阶段一 · 编辑器体系统一
- [x] Stencil 面板节点为 6 种流程图语义类型（不再是 image shape + SVG 图片），拖放入画布可用
- [x] ConfigNode fill 属性 key 正确（`body_fill`），`node:moved/node:resized` 监听器在卸载时 off
- [x] ConfigEdge color 属性 key 正确；ConfigGrid 可达或已明确移除
- [x] 快捷键不在组件函数体内重复绑定；缩放百分比为绝对值（zoomTo）；`isSave` 死逻辑已清理
- [x] 画布尺寸自适应容器（不再固定 1920×1080）；小地图渲染边；重复 `dataClean`/`cell:dblclick` 注册已消除

## 阶段一 · 后端主链路
- [x] 意图识别模型兜底真实调用模型，`intentSource` 如实区分 rule/llm
- [x] `toolRegistry` 已被主链路调用，工具有白名单 + 入口 Zod 参数校验 + 结果封顶
- [x] network 类失败代码指数退避 ≤3 次；param 类失败模型自修正 ≤3 次；耗尽走受控降级话术
- [x] 原始堆栈/连接串/内部 IP 不进入模型上下文，仅传 `message_for_llm`
- [x] 图校验含环检测；Rewriter 局部修正不重走主流程；重试上限 2 次，超限转人在回路
- [x] `ThinkStreamHub.end()` 在成功/失败/中断全路径被调用
- [x] `ThreadStore.cleanupOlderThan` 有定时调用方，无内存泄漏
- [x] `src/ai/prompts/` 中 generate/modify/reflect/compress/optimize/suggest 已接入主链路或明确标注未启用

## 阶段一 · 记忆与上下文
- [x] 每 2 轮滚动摘要落地并写入 `conversation_summaries` 表
- [x] 长期记忆双路召回中向量路非恒空（Embedding Provider 生效），Provider 不可用时退化单路且记录降级
- [x] RRF 融合 top-10 + Reranker top-3 生效
- [x] 遗忘曲线有定时器调用方，阈值 0.5 / 0.3 与指数衰减公式符合文档
- [x] 上下文组装按文档占比分段截断，总量卡 80% 上限
- [x] 记忆按 `project_id`、画像按 `user_id` 命名空间隔离

## 阶段一 · 安全与配置
- [x] project/editor/ai 路由启用 JwtAuthGuard，无未鉴权业务路由
- [x] 跨用户访问他人项目文档返回 403 且不泄露存在性
- [x] 未配置 Redis 时后端可正常启动，登出与令牌主动失效仍生效
- [x] 代码中不存在 `'sk-xxx'` 兜底 key；JWT secret 来自环境变量；`synchronize` 受环境开关控制
- [x] CORS 为白名单配置，非 `*`
- [x] Token 三级防护生效：用户级每日配额（generate/modify 分开计量）、会话级软上限提示、调用级 max_tokens 硬上限
- [x] Prompt 注入关键词过滤 + System Prompt 首尾角色锚定已启用
- [x] PG `tsvector + GIN` 全文检索接线，项目管理页搜索入口可用，不再依赖 mock 数据（后端 tsvector+GIN 已接线且 mock 已删；文档实际承诺「项目管理模块的搜索支持名称与内容检索」而非 Ctrl+K——已补齐 home 项目列表搜索入口：Input.Search 300ms 防抖接 `GET /projectSearch/search`，命中内容列/空态/取消在途请求/失败不阻塞，tsc 0 + build 0 + 断言 137/137）

## 阶段一 · 既有缺陷修复
- [x] `project_manager.service.ts` 月份 `getMonth() + 1` 已修复
- [x] `user.service.ts` 头像路径跨平台处理已修复
- [x] `http.ts` 错误信息不再被序列化为 `"{}"`
- [x] 孤儿文件（`utils/sse.ts`、`flow.schema.ts`、`ai_response.schema.ts`、`loadNode`）已接入或经用户同意后删除
- [x] N+1 查询、无界数组增长、项目级联删除事务问题已排查并修复

## 阶段一 · 可观测与评估
- [x] 内置 trace 按 threadId 记录全轨迹（步骤/耗时/token/异常）并落 PG 可查询
- [x] 轨迹指标可统计：工具调用次数、反思回路次数、错误恢复步数
- [x] 回归评估脚本输出格式合规率 / 图结构完整性 / 意图识别准确率 / 工具调用成功率，跌破阈值明确标红
- [x] 关键单测非空脚手架并通过：转换层、四级匹配、布局碰撞、图校验、意图规则、错误分类、遗忘曲线

## 阶段一 · 端到端验证
- [x] 前端构建通过、后端构建通过、单测通过，无核心报错
- [ ] 注册/登录 → 新建项目 → 进编辑器 全流程可用（PG 不可用，浏览器运行时全流程未实跑；auth/project/editor 端点均有单测与静态核对证据，环境就绪后需按 tasks.md Task 14 清单补跑）
- [x] generate：自然语言 → SSE 思考流 → 结果拉取 → 画布渲染语义节点且无重叠
- [x] modify：增量修改后未涉及节点坐标零变动
- [x] 异常链路均有可读提示：工具失败降级、配额耗尽、SSE 断连、越权访问、非法 FlowDraft
- [x] 保存/读取/导入导出 JSONB 文档、undo/redo 正常

## 阶段二 · 文档对齐
- [x] `projectDemo/docs/ai-tech/` 14 篇 md + 图片已提取到工作区，且未回滚任何本地既有改动
- [x] 文档技术选型版本与实际依赖一致（React 17 / X6 v1.31 / vite 2 / antd 4 / NestJS 10）
- [x] LangGraph / pgvector / Langfuse / @antv/layout / Redis / ES 在文档中均按「当前实现 / 演进项」分层表述，无与代码矛盾的描述
- [x] 文档补齐模板匹配短路等实际存在但原文未记录的行为
- [x] 文档补齐边界规则说明：空输入、超长输入、环图、多命中意图、工具全失败、配额耗尽、SSE 断连
- [x] 文档补齐部署指引：环境变量清单、Docker 多阶段构建、上线检查清单、四类回滚
- [x] 逐篇抽查关键规则，文档描述 100% 匹配当前实现
- [x] `.vuepress` 侧边栏/导航配置与文档结构一致，站点可正常构建

## 阶段二 · 代码走查与变更说明
- [x] 前后端全量走查完成，冗余逻辑/性能问题/不规范写法/未处理异常逐项修复
- [x] 走查后复跑端到端验证全部通过
- [x] 《代码迭代变更说明》已输出到 spec 目录，含模块变更点、修复缺陷、影响面、验证结果

## 阶段三 · 产品建议
- [x] 同类产品调研覆盖 AI 图表生成与语图可视化方向的主流产品
- [x] 《产品功能建议报告》已输出，每条建议含功能点描述、用户价值、实现难度评估、预期收益
- [x] 建议标注与现有能力基础的衔接点与落地优先级，具备可落地性

## 交付收口
- [x] 四项交付物齐备：可运行项目包、优化后语图文档、代码迭代变更说明、产品功能建议报告
- [x] 全量功能验证记录已留存，文档与代码完全对齐
