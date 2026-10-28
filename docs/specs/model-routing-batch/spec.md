# 模型路由批次（model-routing-batch）Spec

> 状态：已实施（2026-10-28 凌晨批次）｜ 日期：2026-10-28 ｜ 优先级：P1（成本 + 商业化 + 体验）
> 目标：Trae 式模型选择 —— 模型列表手选直通；Auto 模式按请求复杂度自动分配「旗舰 / 轻量」档。
> 依据：2026-10-27 会话确认的方案（复杂度路由不单独调模型、误判靠事后升级而非前置精判、旗舰档挂会员权益）。

## Why（痛点 → 现状证据）

1. **成本一刀切**：主生成硬编码走 `models.large`（qwen-plus，`graph.ts` callLlm），简单请求与复杂请求同价；
   工厂里的 `small` 档声明后无调用方（死档位）。
2. **试用是纯成本项**：免登录试用三层防线只拦频次不控单价，每次试用都烧旗舰价。
3. **商业化缺模型差异**：会员与免费用户只有次数差异（3 vs 30 次/日），没有权益感知更强的模型差异。
4. **用户无控制感**：对齐 Trae/Cursor 的交互预期 —— 想要质量手选旗舰、想要速度手选轻量、不想操心交给 Auto。

## What Changes

### ADDED-1 生成档位与请求契约（后端）

- `chat.schema.ts`：`MODEL_PREFERENCES = ['auto','flagship','flash']`；`ChatRequestSchema.modelPreference`
  （可选枚举，缺省 auto；白名单外 400）。试用端点 `TrialChatRequestSchema` **不收**该字段。
- 结果契约：`Generate/Modify/ConsultResultSchema` 新增可选 `routedModel`（实际档位观测字段，graph 节点 4.5 注入）。
- `llm.factory.ts`：新增 `flash` 轻量生成档（env `LLM_MODEL_FLASH`，默认 qwen-turbo，温度 0.15）；
  `getModelForTier()` 按档取模型，未知档位保守回落旗舰。

### ADDED-2 复杂度路由器（纯函数，`agents/model-route.ts`）

决策优先级：**试用强制 flash → 手选直通（flagship 需会员，非会员平滑回落 Auto）→ Auto 分层**。
Auto 分层 = 确定性规则（零 token）→ 意图模型兜底顺带输出的 complexity → 保守默认旗舰：

- 规则判 simple：≤40 字 + 无分支信号词 + ≤1 个箭头 → flash；
- 规则判 complex：≥2 个分支信号词 / 箭头 ≥4 / 分号换行 ≥4 / 长度 ≥120 → flagship；
- 拿不准（中等长度、单信号）→ 复用意图分类那次 medium 调用顺带输出的 complexity（**一次调用两用，
  绝不为判级单独调模型**）；模型也没说 → 旗舰（误判到轻量的代价是「产品变笨」，比多花钱更伤）。

### ADDED-3 意图分类顺带输出复杂度

- `INTENT_SYSTEM_PROMPT` 改为输出 JSON `{"intent","complexity"}`；zod 契约加可选 `complexity`
  （向后兼容：单词形态/缺省仍解析通过）；`IntentRecognizer/IntentResult` 透传。
- 规则命中意图（80%+ 场景，不调模型）时无 llm 复杂度 —— 由路由器自己的规则层兜住，语义不变。

### ADDED-4 状态图接线（`agents/graph.ts`）

- **节点 1.2（新增）**：意图识别后、形态路由前，`decideGenerationTier` 决定 `state.modelTier`
  （consult 固定 medium 不经过路由；人在回路恢复执行时已预置则跳过）；trace 新步骤 `model.route`。
- **callLlm**：`getModelForTier(state.modelTier)` 取模型（替换硬编码 large），trace meta 记实际档位。
- **Flash 失败升级链**：5 处 Rewriter 重试点在 `loop.consume()` 后调用 `escalateModelTierOnLastRetry` ——
  轻量档生成连续反思失败且**下一次即末次重试**时升级旗舰再试一把，旗舰也失败才转人在回路（行为不变）。
  试用链路同样允许升级：一次失败的试用 = 试用名额浪费 + 转化流失，比多花一次旗舰调用更贵。

### ADDED-5 前端模型选择器（浮窗）

- `utils/modelPreference.ts`：选项定义 + localStorage 读写净化（脏数据一律回落 auto）+ 纯函数核心。
- `ai_float_window.tsx`：输入区上方新增 MODEL 选择行（智能路由 / 旗舰模型·会员 / 轻量快速）；
  旗舰档非会员置灰展示「· 会员」；变更即持久化；**试用模式隐藏**（后端强制轻量，展示会造成可自选的错觉）。
- `aiClient.startChat`：登录链路且偏好 ≠ auto 时携带 `modelPreference`；试用链路不携带。
- 会员态来源：浮窗已有的 quota 视图（`vipDaysLeftState`），不新增请求。

### MODIFIED-1 会员权益挂钩（商业化）

- 手选旗舰 = 会员权益：非会员请求 flagship 由后端 `quota.isVipNow()`（新方法）判定后平滑回落 Auto 路由，
  前端同步置灰引导开通（双保险，后端为准）。Auto 路由不受会员限制（复杂请求质量优先）。

### MODIFIED-2 试用链路成本控制

- `decideGenerationTier` 对 `isTrial` 强制返回 flash（source=trial-force），忽略一切偏好；
  末次重试升级链对试用同样生效（救质量优先于省这一次调用）。

### FIXED-1 模板命中轮误扣生成次数（quota bug）

- 现象：`assertCanRun` 的 429 文案承诺「模板一键生成不消耗额度」，但 `executeGraph` 的
  `quota.consume` 并未排除 `templateMatched` 轮 —— 模板命中明明零 LLM token，却照扣 1 次生成。
- 修复：计量条件加 `!(templateMatched && intent==='generate')`；增长埋点本就区分 template/real，不受影响。

## 明确不改

- `medium` 档职责不变（反思/重写/consult/摘要/rerank）；`small` 档保留（意图兜底备用）。
- 配额次数口径不变（模板轮免费后，生成次数消耗只发生在真实 LLM 轮）。
- 节点 1.2 不改变意图/形态路由的任何既有语义（只读地「追加」档位维度）。

## 验收

- 后端：`tsc --noEmit` 0 错误；`model-route.spec.ts` 14 用例覆盖规则/优先级/会员闸门；
  意图/服务既有套件回归绿（全量结果见 checklist）。
- 前端：`tsc --noEmit` 0 错误；`modelPreference.check` 6 用例绿；浮窗选择器渲染于登录态浮窗。
- env：`LLM_MODEL_FLASH` 已记入两份部署运维手册。
