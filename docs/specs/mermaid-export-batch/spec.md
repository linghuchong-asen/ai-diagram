# Mermaid 导出 + 断言闸门修复（mermaid-export-batch · Round D）Spec

> 日期：2026-10-26 ｜ 依据：功能建议报告 R3 档二「Mermaid 代码导出」（战略价值：接入 diagram-as-code 生态，导出物可粘进 GitHub/Notion/语雀原生渲染，头部署名注释让导出物即传播物）
> 结论：**完成并通过验收**（toMermaid.check 10/10；transform.check 修复后 22/22；tsc 0 错误）。

## 变更

- 新增 `utils/toMermaid.ts`：FlowDraft（x6ToFlowDraft 同构契约）→ Mermaid flowchart 文本；六种语义节点形状映射（start/end 胶囊、process 矩形、decision 菱形、io 平行四边形、subprocess 子程序框）；id 归一去重、标签引号/竖线/换号清洗、悬空边丢弃（与 droppedEdges 同语义）；头部 `%%` 署名注释（品牌 + 当前站点）。
- 预览页新增「Mermaid」按钮 → 弹窗展示代码 + 复制 + 下载 .mmd。
- **修复存量断言漂移**：transform.check.ts 两处边默认描边预期 `#A3B1BF` → `#7d8fb0`（Neon Dark 重配色后的有意行为，buildEdgeAttrs/useGraph/ConfigEdge 三处同色；原预期未随主题更新，属检查侧漂移）。

## 验收证据

- `src/utils/__checks__/toMermaid.check.ts`：10/10 通过（形状映射/未知类型降级/边标签语法/悬空边丢弃/竖线替换/引号换行清洗/id 归一去重/头部署名/方向切换/空图防御）。
- `src/pages/ai/__checks__/transform.check.ts`：22/22 通过（由 20/22 修复）。
- 前端 tsc --noEmit：0 错误。
