# 思维体质图 + 一图看懂文件上传（mind-quiz-batch · Round E/F）Spec

> 日期：2026-10-26 ｜ 依据：《魔性传播与商业化功能战略》A4（思维体质图）与 A1 增强（文件输入）
> 结论：**完成并通过验收**（archetype.check 9/9、textFile.check 8/8、后端 jest 34/334 全绿、前端 8 脚本 164/164、评估闸门 54/54）。

## Round E · 思维体质图（/mind）

- **机制**：5 道情境单选（每题 4 选项分别倾向四种原型，均衡设计）→ 计点制得出思维原型（决策树型/放射型/泳道型/环路型）→ 结果卡 + 「生成我的思维画像图」直达 /trial（prompt 按拓扑结构定制，保证引擎画出对应形态的图）。
- **合规设计**：MBTI 机制的合规化改造 —— 产出物是「思维结构画像图」工具而非测试类 H5；无对错、无预测、不涉运势命理；平票按固定顺序取先者（同答案必同结果）。
- **实现**：`pages/mind/archetype.ts`（纯函数映射，无 React 依赖，断言全覆盖）+ `pages/mind/index.tsx`（答题页，提交后锁定）+ 路由 `/mind`（公开）。
- **埋点**：`mind_complete`（带 `mind:<archetype>` 渠道码，衡量哪种原型最引流）—— 后端白名单 +1（growth-track.controller，spec 同步 +1 用例）。
- **断言**：`pages/mind/__checks__/archetype.check.ts` 9 用例（四原型可达、3:2 多数胜出、平票确定性、未答跳过、全未答兜底、非法下标防御、题目 5×4 与倾向均衡、档案完整、answeredCount）。

## Round F · 一图看懂支持 txt/md 上传

- **实现**：`utils/textFile.ts`（`readTextFile`：扩展名/MIME 白名单 + 2MB 上限 + FileReader 客户端读取，不经服务器、内容不落盘；`clipToLimit`：按 Unicode 码位安全截断）+ digest 页上传入口（超 500 字自动截断并提示「注册后可处理 2000 字」—— 长文需求转化为注册动机）。
- **断言**：`utils/__checks__/textFile.check.ts` 8 用例（边界/Unicode emoji 安全/limit=0 防御/.txt/.md 正常读/.exe 拒绝/超 2MB 拒绝）。

## 验收证据汇总

| 项 | 结果 |
|---|---|
| 前端断言脚本（8 个） | **164/164 通过**（含本轮新增 toMermaid 10、textFile 8、archetype 9） |
| 后端 jest | 34 套件 / **334 用例**全绿（growth-track spec +1） |
| 前端 tsc / vite build | 0 错误 / 通过（4680 modules） |
| 回归评估闸门 | 54/54 通过 |
