# Tasks

> 手册全文草案见同目录 `语图项目部署运维手册-完整版.md`（实施阶段的唯一内容基线）。

- [x] Task 1: 部署事实清单核查（已完成）
  - [x] SubTask 1.1: 环境变量全量清单及代码出处（手册附录 11.1）
  - [x] SubTask 1.2: 运行时事实核验：dist/src/main.js 路径、.env.prod 按 CWD 解析、uploads=/app/uploads、logs=/app/dist/logs、DB_SYNCHRONIZE 生产 false、Redis/ES 无运行时依赖、SSE 公开端点、/api rewrite、BrowserRouter
  - [x] SubTask 1.3: 构建与环境事实：本机即目标 ECS（eipv4=8.140.203.51）、pnpm 12.14.0（华为镜像，corepack 不可用）、Docker 未装、Docker Hub 需加速、表名清单（user/project/editor_document/auth_tokens/conversation_summaries/ai_long_term_memories/ai_checkpoints/ai_trace/ai_trace_step/ai_daily_usage/search_index）
- [x] Task 2: 完整手册起草（`语图项目部署运维手册-完整版.md`，11 章全文含全部命令与配置）——待用户批准后定稿
- [x] Task 3: 落地部署工件到仓库（按手册逐字一致）
  - [x] SubTask 3.1: deploy/Dockerfile.backend、deploy/Dockerfile.frontend、deploy/nginx.conf
  - [x] SubTask 3.2: deploy/docker-compose.yml、deploy/.env.prod.example
  - [x] SubTask 3.3: deploy/scripts/{deploy.sh,rollback.sh,backup.sh,inspect.sh}（可执行权限）
  - [x] SubTask 3.4: 手册定稿到 docs/deployment/语图项目部署运维手册.md
- [ ] Task 4: ECS 真实部署（执行手册第 2、5 章）
  - [ ] SubTask 4.1: 安装 Docker + compose 插件（阿里云 apt 源）+ 镜像加速 daemon.json + hello-world 拉取验证
  - [ ] SubTask 4.2: 创建 /opt/yutu 目录树；同步 deploy/ 工件；生成 .env.prod（openssl 生成 DB 密码与 JWT_SECRET，chmod 600）
  - [ ] SubTask 4.3: 构建两镜像（TAG=时间戳；如 Docker Hub 拉取基础镜像失败，按手册 10.2 故障8 切换加速源）
  - [ ] SubTask 4.4: 启动 postgres → 两步法建库（DB_SYNCHRONIZE=true 建表 → \dt 验证 11 表 → 删除开关 → restart）→ up -d 全栈
  - [ ] SubTask 4.5: 执行手册 5.6 验证清单 ①-⑪ 并记录结果
  - [ ] SubTask 4.6: 5.7 公网验证：本机 EIP curl 200；外部连通性请用户确认（安全组 80 需控制台放行）
  - [ ] SubTask 4.7: crontab 三任务安装 + backup.sh/inspect.sh 手动试跑
- [ ] Task 5: 按 checklist.md 逐项核验并勾选；手册与实际部署结果如有出入（路径/表名/命令输出），回写修正 docs/deployment/ 定稿

# Task Dependencies

- Task 3 → Task 4（先有工件再部署）
- Task 4 → Task 5（部署完成才能核验）
- Task 3 的 4 个 SubTask 可并行；Task 4 内部严格顺序
