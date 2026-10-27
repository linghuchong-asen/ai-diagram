# Checklist · 多形态产物 Agent 十轮（multi-artifact-batch）

> 验收闸门：逐项可验证；全部勾选后方视为批次完成。
> **验收结论（2026-10-26）：全部通过。** 后端 jest 全量 **40 套件 / 395 用例全绿**（新增 5 个 spec 共 47 用例）；
> 前端断言脚本 **14 个全绿**（新增 artifact.check 15 用例）；前端 tsc 0 错误 + vite build 通过；
> 后端 tsc 0 错误。

## Schema 与契约
- [x] `ArtifactKind` 五值枚举（flowchart/mindmap/table/checklist/timeline）在后端 schema 与前端镜像双侧存在且一致
  - 后端 `serverend/src/ai/schemas/artifact.schema.ts`；前端镜像 `frontend/src/utils/aiClient.ts`（不 import 后端文件）
- [x] 四种新形态 Schema：合法样例通过、非法样例（缺字段/超界/类型错）被拒并给出中文错误信息（artifact.schema.spec 11/11）
- [x] 向后兼容：`generate` 结果不含 `artifactKind` 时按 flowchart 消费，旧前端/旧分享链路零影响
  - graph.artifact.spec ④：flowchart 链路 result 无 `artifactKind` 字段，上下文回退 SYSTEM_PROMPT
- [x] `formHint` 请求字段白名单校验：非法值 400，不透传到模型（ArtifactFormHintSchema + controller zod 前置校验）

## 形式路由
- [x] 规则路由零 token：四形态关键词样例直接命中，不调用 LLM（form.router.spec ②）
- [x] `formHint` 优先级最高：显式指定时跳过规则与 LLM（form.router.spec ① + graph 集成 ①）
- [x] LLM 兜底：规则未命中/歧义时分类（medium 模型 + 4s 超时）；不可用/输出非法/超时默认 flowchart，不报错不阻塞（form.router.spec ③④）
- [x] 路由结果记入 state（artifactKind/artifactSource/artifactReasons，Logger.debug 透出）

## 生成与反思
- [x] 四形态各自 Prompt 含明确 JSON 契约与 `<thinking>` 约定，与 SYSTEM_PROMPT 安全边界一致（artifact.prompts.spec 9/9）
- [x] 校验器按形态输出 error/warning 两级问题；error 触发 Rewriter 修正循环，超限转人在回路（artifact.validator.spec + graph.artifact.spec ②③）
- [x] 修正提示词按形态注入校验要点（Rewriter artifactKind 措辞分支，非流程图专用文案）
- [x] 模板短路（template_match）仅 flowchart 生效；quota/growth 计量口径不变（graph 条件分支 + service 无改动）

## 前端
- [x] aiClient 类型与后端契约一致（不 import 后端文件；ArtifactKind/四形态 Draft/GenerateResult 扩展）
- [x] mindmap 纯函数布局：坐标无重叠、父居中、连线父子闭合（artifact.check ② 4 用例）
- [x] 四形态 Markdown 导出：表格表头分隔行对齐、清单 GitHub 任务语法、时间线递增序号（artifact.check ③ 4 用例）
- [x] 浮窗按 artifactKind 分发渲染；mindmap 可「应用到画布」（复用 flowDraftToX6 预览/合并链路），table/checklist/timeline 提供复制 Markdown
- [x] 快捷 chips 覆盖四新形态（方案对比表/会议待办清单/旅行时间线/读书思维导图，点击即带 formHint 发送）
- [x] 脏数据归一化：缺字段/非法枚举降级不抛异常；完全不可用返回 null 并如实提示（artifact.check ① 7 用例）

## 回归
- [x] 后端 jest 全量全绿：**40 套件 / 395 用例**（原 35 套件 348 用例 + 新增 5 spec 47 用例，0 回归）
- [x] 前端全部 `__checks__` 脚本全绿：**14 个**（新增 artifact.check；顺带修复存量 textFile.check 在纯 Node 下缺 FileReader 全局的崩溃——补最小等价桩，断言语义不变）
- [x] 前端 `npm run build`（tsc + vite）通过；后端 `tsc --noEmit` 0 错误
