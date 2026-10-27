# 多形态产物 Agent · 十轮（multi-artifact-batch · Round 1-10）Spec

> 日期：2026-10-26 ｜ 命题：不局限于流程图——把语图当作「解决问题的 Agent」思考：流程图是最核心场景，但产物可以是其他图（思维导图），甚至不是图（表格/清单/时间线）。运行十轮：头脑风暴 → 构思 → 写码 → 测试 → 运行。

## 一、头脑风暴：从痛点出发，而不是从图出发

### 1.1 核心洞察

用户真正的输入不是"帮我画个图"，而是**一个待解决的问题**。问题本身决定了最合适的产物形态：

| 问题的本质结构 | 最合适的产物形态 | 例子 |
|---|---|---|
| 有先后顺序、有分支判断 | **流程图** flowchart | 审批流、故障排查 SOP、部署上线 |
| 有层级、有包含关系、需要发散 | **思维导图** mindmap | 读长文做笔记、需求脑暴、知识体系梳理 |
| 多个对象 × 多个维度需要横向比较 | **对比表格** table | 技术选型、offer 对比、方案评审 |
| 可枚举、可勾选、怕遗漏 | **清单** checklist | 会议待办、装修流程核对、发布检查单 |
| 有时间轴、有先后与并行 | **时间线** timeline | 旅行行程、项目排期、活动策划 |

现有架构把 `generate` 意图硬绑定到 `FlowDraft`（6 种流程图节点），等于强迫所有问题都用"流程图"这把锤子敲——会议记录整理（要清单）、方案对比（要表格）这类高频痛点完全无法承接。

### 1.2 工作 + 生活痛点清单（头脑风暴全集）

**工作场景：**
1. **会议记录没人整理**：会开完了，决议/待办/责任人一团糟 → 清单（分组待办 + 责任人 + 截止时间）
2. **方案对比纠结**：选型 A vs B vs C，参数零散记不住 → 对比表格（维度 × 方案 + 推荐结论）
3. **长文/报告没时间读**：30 页文档要 5 分钟抓住骨架 → 思维导图（层级摘要）
4. **项目排期对不齐**：任务多、时间乱 → 时间线（按天/周排布）
5. **SOP/审批/排查**：步骤有先后有分支 → 流程图（现有核心，不变）
6. **周报复盘流水账** → 思维导图（本周成果结构化）

**生活场景：**
7. **旅行计划乱**：攻略收藏一堆 → 时间线（行程）+ 清单（行李/必做）
8. **装修/搬家易漏项** → 清单（阶段核对）+ 表格（预算对比）
9. **备考/学习知识散** → 思维导图
10. **大事决策（买房/offer/学校）** → 对比表格（多维权衡打分）

### 1.3 产品定位升维

- 旧：语图 = 对话式**流程图**生成器
- 新：语图 = 对话式**问题结构化 Agent**——把非结构化的问题描述转成最合适形态的结构化产物；流程图仍是旗舰场景（模板/编辑器/分享生态不动），新增四种产物形态承接上述痛点

## 二、架构决策（沿用"确定性程序优先"哲学）

### 2.1 产物类型体系 ArtifactKind

```
ArtifactKind = 'flowchart' | 'mindmap' | 'table' | 'checklist' | 'timeline'
```

- `generate` 意图不再等价于流程图：意图（要不要产结构）与形态（产什么结构）**两级解耦**
- 前向兼容：`AiResult.kind='generate'` 仍是流程序列，新增 `artifactKind` 字段 + 各形态 payload；`artifactKind='flowchart'` 或字段缺失时仍输出 `flowDraft`，旧前端/旧分享不受影响

### 2.2 形式路由 FormRouter（generate 意图内的二级路由）

- 位置：意图识别（节点 1）之后、LLM 生成（节点 4）之前
- 策略：**规则优先**（关键词命中直接定形态，零 token）→ **LLM 兜底**（small 模型分类，复用意图识别的分层模式）→ 默认 `flowchart`（旗舰场景兜底）
- 用户显式指定最高优先：请求体新增 `formHint`（白名单枚举校验），前端快捷 chips 使用

### 2.3 每形态四件套（新增产物 = 加四件套 + 注册一行）

| 形态 | Schema（Zod） | Prompt 要点 | 校验器 | 前端渲染 |
|---|---|---|---|---|
| mindmap | 树形 `topic/children[]`，深度≤4、节点≥5 | 层级发散，一词一节点 | 根唯一/深度/节点数/叶子占比 | 思维导图树（X6 画布可进） |
| table | `columns[]/rows[][]` + 可选 `conclusion` | 维度为列方案为行，空单元格写 `—` | 列≥2/行≥2/单元格非空/列齐整 | antd Table（对话内） |
| checklist | `groups[]{title,items[]{text,owner?,due?}}` | 可勾选、可归属 | 组≥1/项≥2/文本非空 | 分组勾选卡（对话内） |
| timeline | `events[]{time,title,detail?}` | 按时间先后 | 事件≥2/时间字段存在 | antd Timeline（对话内） |

- 坐标/样式仍由前端程序化生成（mindmap 复用该原则：模型只出树，布局算坐标）
- 表格/清单/时间线**不进画布**：在对话流内渲染 + 一键复制 Markdown（解决"不是图"的归宿问题）

### 2.4 状态图与校验闭环复用

- 反思循环（生成 → 校验 → Rewriter 局部修正 → 人在回路）对所有形态复用：`ReflectionSubject` 扩展 artifact 分支，`Rewriter` 的修正提示词按形态注入对应校验要点
- 模板短路（template_match）仅对 flowchart 生效；quota 计量按 `generate` 意图不变（商业化口径不动）

## 三、十轮计划与结果

| 轮 | 主题 | 交付物 | 测试 | 结果 |
|---|---|---|---|---|
| 1 | 头脑风暴 + 规格 | 本 spec + tasks/checklist | — | ✅ |
| 2 | 产物 Schema 体系 | `schemas/artifact.schema.ts`（4 新形态） | artifact.schema.spec | ✅ 11/11 |
| 3 | 形式路由器 | `form/form.router.ts`（规则+LLM 兜底+formHint） | form.router.spec | ✅ 11/11 |
| 4 | 形态 Prompt | `prompts/artifact.prompts.ts`（4 形态生成指令） | artifact.prompts.spec | ✅ 9/9 |
| 5 | 形态校验器 | `reflection/artifact.validator.ts`（结构校验）+ evaluator 分支 | artifact.validator.spec | ✅ 反思层 23/23 |
| 6 | 状态图接入 | graph.ts 节点 1.5 + 生成分支 + service/confirm 还原 | graph.artifact.spec + src/ai 全量 | ✅ 7/7 + 224/224 |
| 7 | 前端镜像 + 纯逻辑 | aiClient 类型 + `artifacts/`（归一化/布局/Markdown） | artifact.check | ✅ 15/15（修 2 个实现 bug） |
| 8 | 渲染器 + 浮窗集成 | 深色自绘渲染组件 + 分发 + 4 形态快捷 chips | tsc + 既有 check | ✅ tsc 0 错误 |
| 9 | 全量回归 | 后端 jest 全量 + 前端 14 check + build | 见验收证据 | ✅ 全绿 |
| 10 | 文档收尾 | checklist 勾选 + changelog + `docs/tech/artifact.md` | — | ✅ |

## 四、验收证据（Round 9 汇总）

| 项 | 结果 |
|---|---|
| 后端 jest 全量 | **40 套件 / 395 用例全绿**（原 35 套件 348 用例，新增 5 spec 47 用例，0 回归） |
| 前端断言脚本 | **14 个全绿**（新增 `pages/ai/__checks__/artifact.check.ts` 15 用例） |
| 前端 tsc / vite build | 0 错误 / 通过（index-218112d0.js 4092 KiB） |
| 后端 tsc | 0 错误 |

过程中断言抓出并修复的实现缺陷：
- mindmap 归一化的自动补 id 与既有 id 撞车（`m1` 已被根占用又生成 `m1`）——生成序列跳过已占用值；
- timeline Markdown 导出序号全部为 `1.`（未递增）——改为按索引递增，纯文本阅读也成立；
- 存量 `textFile.check.ts` 在纯 Node 环境缺 `FileReader` 全局导致崩溃（与批次无关的环境性缺陷）——补 `File.text()` 最小等价桩，断言语义不变。

## 五、验收标准（checklist.md 详列）

1. 五种形态端到端可用：`formHint` 指定 → 对应 schema 产物 → 前端正确渲染
2. 规则路由零 token 命中四形态关键词；未命中走 LLM 兜底；异常默认 flowchart
3. `artifactKind` 缺失时行为与旧版完全一致（向后兼容，旧分享/旧前端不受影响）
4. 非画布形态提供"复制 Markdown"出口；mindmap 可"应用到画布"
5. 后端 jest 全量全绿、前端全部 check 脚本全绿、前后端 tsc 0 错误
