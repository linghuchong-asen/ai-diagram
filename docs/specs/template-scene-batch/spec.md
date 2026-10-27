# 模板场景扩充（template-scene-batch · Round C）Spec 与验收

> 日期：2026-10-26 ｜ 依据：《魔性传播与商业化功能战略》B 层（B6/B7/B1/A6）的 prompt 级先导
> 结论：**完成并通过验收**（后端 jest 34 套件 / 333 用例全绿；回归评估闸门 54/54 通过——模板匹配用例无回归）。

## 变更

模板中心静态预置 **12 → 16**，新增 4 个场景（均为「粘贴文本 → 图」的低成本先导，工程上零新依赖，仅扩静态数组）：

| id | 模板 | 对应战略项 | 价值 |
|---|---|---|---|
| work-meeting-minutes | 会议纪要转泳道图 | B6 | Mapify 等只做导图；流程图范式空白 |
| dev-prd-user-flow | PRD 转用户流程图 | B7 | PMAI 产文档不产可编辑图 |
| campus-thesis-roadmap | 论文技术路线图 | B1 | 开题季（11-1 月）季节性刚需的 prompt 级先导 |
| work-year-review | 年终述职一图流 | A6 | 12 月年报季战役模板 |

## 验收证据

- template.service.spec：16 数量断言 + 新增 id 在列断言（+1 用例，全绿）。
- 全量 jest：34 suites / 333 tests passed。
- 回归评估：54/54 通过（模板匹配准确率 5/5 未受新增模板影响）。
- 前端无改动（模板页动态渲染后端列表，自动带出新模板）。

## 后续衔接

- B1（论文/Word→技术路线图）正式版上线后，campus-thesis-roadmap 升级为「上传文档」入口。
- 年报季战役（12 月）将 work-year-review 与 /annual 代码年报组成内容包投放。
