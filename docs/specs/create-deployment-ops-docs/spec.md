# 语图项目部署运维文档与真实部署 Spec（v2）

## Why

v1 版 spec 只规划了"文档提纲"，用户明确反馈：需要的是**完整、具体、全面、有细节、可直接落地执行**的正式文档（一篇），并且要**真正部署到 8.140.203.51 的 ECS 上**。经核实，当前开发机本身就是目标 ECS（阿里云元数据 eipv4=8.140.203.51，主机名 iZ2zeasljcikibllbkhl1gZ，Ubuntu 22.04，Docker 未安装），部署在本机执行，无需远程 SSH。

## What Changes

- **完整手册已起草**：`.trae/specs/create-deployment-ops-docs/语图项目部署运维手册-完整版.md`（约 700 行，含全部可执行命令与完整配置文件内容：Dockerfile×2、nginx.conf、docker-compose.yml、.env.prod 模板、deploy.sh/rollback.sh/backup.sh/inspect.sh、crontab、恢复 runbook、故障矩阵、附录对照表）。
- **实施阶段交付物**：
  1. `docs/deployment/语图项目部署运维手册.md` —— 手册定稿（以草案为基线，随真实部署结果修正）。
  2. `deploy/` 部署工件 —— Dockerfile.backend、Dockerfile.frontend、nginx.conf、docker-compose.yml、.env.prod.example、scripts/{deploy.sh,rollback.sh,backup.sh,inspect.sh}。
  3. **真实部署**：在本 ECS 上按手册执行——安装 Docker（阿里云源+镜像加速）、构建前后端镜像、首次两步法建库、上线三容器、执行验证清单、配置 crontab。
- 不修改任何业务代码。

## Impact

- Affected code: 不改业务代码；新增 `docs/deployment/`（1 个文件）与 `deploy/`（8 个工件文件）；系统级变更（Docker 安装、/opt/yutu 目录、crontab、生产容器）。
- 依据的关键代码事实（手册草案中已全部核实并标注出处）：生产启动 `node dist/src/main.js`、`.env.prod` 按 CWD 解析、uploads/logs 容器内路径为 `/app/uploads`、`/app/dist/logs`、生产 `DB_SYNCHRONIZE` 默认 false、JWT_SECRET 强制、TOKEN_STORE=pg、无 Redis/ES 运行时依赖、AI 降级模式、SSE 公开端点、`/api` 前缀 rewrite、BrowserRouter SPA fallback。
- 环境事实：本机即 ECS；pnpm 12.14.0 可经华为 npm 镜像安装（corepack 不可用）；Docker Hub 需镜像加速；3.5G 内存/21G 可用磁盘/4G swap；80/3001/5432 端口空闲；ufw inactive（安全由安全组承担）。

## ADDED Requirements

### Requirement 1: 完整部署运维手册
系统 SHALL 在 `docs/deployment/语图项目部署运维手册.md` 提供一篇完整手册，覆盖 11 章：总览/环境准备/构建/配置/首次部署/发版回滚/监控巡检/备份容灾/安全/故障排查/附录，所有配置文件为全量内容，所有命令可直接执行。

#### Scenario: 操作人员照手册部署
- **WHEN** 任何人员按手册第 2→5 章顺序在 ECS 上执行
- **THEN** 三容器上线且验证清单（手册 5.6 ①-⑪）全部通过，浏览器访问 http://8.140.203.51 可用

### Requirement 2: 部署工件仓库化
`deploy/` 目录 SHALL 包含手册引用的全部 8 个工件，内容与手册一致（单一事实来源为手册，工件与手册逐字一致）。

### Requirement 3: 真实部署上线
本 ECS（8.140.203.51）SHALL 真实运行语图生产栈：Docker + yutu-postgres + yutu-backend + yutu-nginx 三容器 healthy，数据库 11 张核心表建成，公网 80 可达（外部视角需用户或安全组规则确认），crontab 备份/巡检/清理三任务就位。

#### Scenario: 部署验证
- **WHEN** 执行手册 5.6 验证清单与 5.7 公网验证
- **THEN** 全部通过；AI 功能按是否配置 DASHSCOPE_API_KEY 呈现完整/降级两种预期状态之一

## Non-Goals

- 不引入 K8s/Langfuse/ELK/Prometheus 为必选项（手册仅给可选路径）。
- 不修改业务代码（含已知的头像接口历史遗留问题，手册 FAQ 已说明）。
- 安全组规则需用户在阿里云控制台核对/放行（ECS 内无法操作控制台；手册 2.2/5.7 已给出核对与验证方法）。
