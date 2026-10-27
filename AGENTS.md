# AGENTS.md

本文件面向在本仓库工作的 AI 编码助手（Agent），请务必遵守以下约定。

## 项目简介

- 语图（Yutu / IdeaCanvas）：对话式 AI 流程图生成器，前端 React + AntV X6，后端 NestJS + PostgreSQL。
- 产品文档位于 `docs/`（specs 为变更规格、growth 为增长运营、deployment 为部署运维、tech 为技术说明）。

## 强制规范

### 1. 功能变更必须形成文档

所有涉及**功能点的新增、修改、删除**，必须同步形成文档，不允许只改代码不留痕：

- 在 `docs/specs/` 下按既有格式（spec.md / tasks.md / checklist.md）建立或更新对应规格文档；改动说明写入 `docs/specs/align-yutu-doc-and-code/code-iteration-changelog.md`。
- 涉及部署、接口、数据库结构的变更，同步更新 `docs/deployment/`、`docs/tech/` 下相关文档。
- 功能下线/删除同样要留档，注明删除原因与影响范围。

### 2. 代码必须写中文注释，文件头部必须加注释

- 所有编写或修改的代码，注释一律使用**中文**。
- **每个文件必须在文件头部加注释**，说明该文件的用途、所属模块；修改文件时应同步更新头部注释，使其与实际内容一致。
- 关键逻辑（算法、降级策略、校验规则、支付/鉴权等）需用中文注释说明"为什么这么做"，而不只是复述代码。
