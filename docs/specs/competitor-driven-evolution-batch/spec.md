# 竞品驱动演进 · 二十轮（competitor-driven-evolution-batch · Round 1-20）Spec

> 日期：2026-10-26 ｜ 依据：`docs/growth/竞品调研-AI图表生成工具全景-2026-10.md` 的差距分析（G1-G10）。
> 命题：围绕产品功能，基于同类产品深度思考二十轮演进方向，每轮写代码写测试。
> 前置：multi-artifact-batch（多形态产物）已完成，本批次在其之上演进。

## 二十轮规划（五条主线 × 差距编号）

### 主线 A：DSL 互操作（G1 — 对标 Mermaid 生态 70k★ / Excalidraw / draw.io）

| 轮 | 主题 | 交付 | 测试 |
|---|---|---|---|
| R1 | 竞品调研 + 本规格 | 竞品全景文档 + spec/tasks/checklist | — |
| R2 | Mermaid 流程图解析器 | `pages/ai/import/mermaid-parser.ts`：graph/flowchart TD\|LR、节点/边/标签/形状 → FlowDraft（纯函数） | `__checks__/mermaid-parser.check.ts` |
| R3 | Mermaid 高级语法 | subgraph→subprocess、菱形/圆角形状映射、注释/样式行容忍、自环/重复边防御 | 同上扩展 |
| R4 | PlantUML activity 解析器 | `pages/ai/import/plantuml-parser.ts`：start/stop/if/else/while/repeat → FlowDraft | `__checks__/plantuml-parser.check.ts` |
| R5 | DSL 导入接线 | `pages/ai/import/dsl-detect.ts`（方言识别）+ 浮窗「粘贴 DSL」入口（导入→画布，走既有 flowDraftToX6 链路） | dsl-detect check + tsc |

### 主线 B：产物深度（G9/G5 — 差异化决策支持 + 对标竞品追问引导）

| 轮 | 主题 | 交付 | 测试 |
|---|---|---|---|
| R6 | 表格加权打分 | `artifacts/table-scoring.ts`：维度权重 → 加权分 + 排序建议（纯函数，分数解析「高/低/3星」） | check |
| R7 | 时间线自然排序 | `artifacts/timeline-sort.ts`：Day1/09:00/第3周/周五 混排 → 稳定排序键（纯函数） | check |
| R8 | 追问建议 | `artifacts/followup-suggest.ts`：per 形态 3 条跟进建议（含「换个形态看」——对标 Napkin 多方案）+ 浮窗 chips 展示 | check + tsc |
| R9 | 表格行内编辑 | TableView 单元格点击编辑 + Markdown 实时重导出（编辑状态组件内） | tsc |

### 主线 C：产物可携带（G6/G4 — 对标 Napkin 导出 / OpenDiagram 版本历史）

| 轮 | 主题 | 交付 | 测试 |
|---|---|---|---|
| R10 | 文件下载导出 | `artifacts/download-artifact.ts`：Markdown Blob 下载（.md 文件，可进 Notion/Obsidian/GitHub）+ 各渲染器入口 | check（文件名生成/类型守卫） |
| R11 | 生成版本历史 | 浮窗会话内产物历史栈：上一版/下一版切换与恢复（flowchart/mindmap 预览与消息产物通用） | 逻辑抽 `session/history-stack.ts` + check |
| R12 | 本地草稿箱 | `utils/artifact-drafts.ts`：localStorage 最近 20 个产物（形态/摘要/时间），浮窗「历史产物」入口回看 + 复制 | check（存取/上限/损坏容错） |

### 主线 D：Agent 智能深化（G7/G8/G10-安全 — 后端）

| 轮 | 主题 | 交付 | 测试 |
|---|---|---|---|
| R13 | artifact 模板短路 | template-matcher 扩展 4 形态模板（高频请求零 token 秒回）+ graph 接线（template_match 支持按形态命中） | jest |
| R14 | 形式路由观测 | TRACE_STEPS 增加 FORM_ROUTE；graph 节点 1.5 埋点（source/kind/是否 LLM）+ updateRun 字段 | jest |
| R15 | 会话形态偏好 | FormRouter 入参 sessionFormUsage：同会话多次用某形态 → 规则前置偏好加权（不覆盖 formHint） | jest |
| R16 | 注入对抗加固 | artifact 四形态系统提示词过注入样本回归（filterUserInput + prompt 边界断言）+ formHint 非法值端到端 400 | jest |

### 主线 E：场景与增长（G2/G7 — 对标 Mermaid AI 文档入口 / ProcessOn 模板生态）

| 轮 | 主题 | 交付 | 测试 |
|---|---|---|---|
| R17 | 新形态场景页 ×4 | 场景工厂 registry +4：对比表/待办清单/旅行计划/读书导图（builder 纯函数 + formHint 进 /trial） | builder check |
| R18 | 模板中心扩展 | 前端模板数据 + 多形态条目（点击带 formHint 进试用）；模板页文案适配 | tsc |
| R19 | 试用页新形态引导 | /trial 页快捷示例加入 4 形态（含移动端适配）；空态文案统一 | tsc |
| R20 | 全量回归 + 收尾 | 后端 jest 全量 + 前端全部 check + build；checklist 勾选；changelog；tech 文档更新；二十轮总结 | 全绿 |

## 验收标准（详见 checklist.md）

1. Mermaid/PlantUML 常见语法 90%+ 用例解析正确，脏语法不抛异常（降级明细）；
2. 打分/排序/建议/下载/历史/草稿箱全部纯逻辑可测，UI 接线 tsc 0 错误；
3. 后端模板短路/观测/偏好/注入加固全部 jest 通过，且 flowchart 既有链路零回归；
4. 全量回归绿（后端 jest 全量、前端 14+ check 脚本、前后端 tsc、vite build）。
