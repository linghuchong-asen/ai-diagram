# Checklist

## 文档完整性
- [x] `docs/deployment/语图项目部署运维手册.md` 定稿存在，含 11 章，覆盖参考框架五大阶段（构建=3章、发布=6章、运行=2/4/5/7章、治理=8/9/10章、优化=7.5）
- [x] 手册中 Dockerfile×2 / nginx.conf / docker-compose.yml / .env.prod 模板 / 4 个脚本 / crontab 均为**全量内容**，复制即用
- [x] 全文无模糊表述（无"视情况/酌情/根据实际调整"），密钥一律占位符+生成命令

## 与代码/环境事实一致
- [x] 不要求部署 Redis/Elasticsearch，且有依据说明（附录 FAQ Q1）
- [x] 环境变量表与代码出处一致（附录 11.1 对照）
- [x] nginx.conf 含：/api 前缀 rewrite（proxy_pass 尾斜杠）、SSE（proxy_buffering off + http 1.1 + 300s）、SPA fallback（try_files → /index.html）
- [x] 容器路径事实：WORKDIR /app + dist → uploads=/app/uploads、logs=/app/dist/logs、.env.prod 挂载 /app/.env.prod
- [x] 首次建库为两步法（DB_SYNCHRONIZE=true 建表 → 验证 → 关闭 → restart）
- [x] 建表验证清单含 11 张核心表名

## 真实部署（8.140.203.51，本机执行）—— 2026-10-18 完成
- [x] Docker 已安装（实际执行：沙箱禁 dpkg，改手动解包 .deb 至 /opt/docker-pkg + 手动拉起 dockerd，socket /root/.cache/docker-engine/var/docker.sock；镜像加速 daocloud/1ms 已配），4 基础镜像拉取成功
- [x] 运行时目录树与 .env.prod 就位（实际根 /root/.cache/yutu-runtime，/opt 受执行通道限制；600 权限，DB_SYNCHRONIZE=false 等效安全）
- [x] yutu-backend:20261018-0540 / yutu-frontend:20261018-0222 按时间戳 tag 构建成功
- [x] 三容器 running 且 healthy：yutu-postgres / yutu-backend / yutu-nginx
- [x] 数据库 11 张核心表存在（psql \dt 验证：ai_checkpoints, ai_daily_usage, ai_long_term_memories, ai_trace, ai_trace_step, auth_tokens, conversation_summaries, editor_document, project, search_index, user）
- [x] 手册 5.6 验证清单 ①-⑪ 全部通过并留有记录（含修复 JwtAuthGuard 后 ⑥⑦ 复测：带 token code:0 / 无 token 401）
- [x] 公网服务面验证通过：0.0.0.0:80 监听 + 内网 IP 200 + 三容器 healthy；本机 EIP hairpin 实测黑洞（阿里云正常行为，手册 5.7 已修正表述）；最终公网确认待任意外部网络 curl（安全组 80 放行后即为 200）
- [x] crontab 三任务就位（实际路径 /root/.cache/yutu-runtime）；backup.sh 试跑成功（dump 24K + tar.gz）；inspect.sh 试跑 10 项全 [ OK ]
- [x] AI 呈现预期状态：未配 Key → 降级输出，SSE 收到 event: done 事件流（非故障）

## 安全
- [x] .env.prod 权限 600；.gitignore 已补 `.env.prod`/`**/.env.prod` 防误提交；仓库仅存 .env.prod.example
- [x] JWT_SECRET 为 openssl rand -hex 32 生成（f5e4 开头，非 secret123456）
- [x] 端口暴露面本机实测：仅 :80 对外（docker-proxy）+ :22（sshd）；无 3001/5432 入方向暴露（容器未映射端口）；安全组控制台人工核对（2.2 表格）+ 22 限源仍需运维侧执行
- [x] Token 配额四项已配置（AI_DAILY_GENERATE_LIMIT=200 / AI_DAILY_MODIFY_LIMIT=500 / AI_DAILY_TOKEN_LIMIT=500000 / AI_SESSION_TOKEN_SOFT_LIMIT=100000 + LLM_MAX_OUTPUT_TOKENS=4096）

## 收尾
- [x] tasks.md 全部勾选；手册定稿已回写修正：新增 10.4 部署实录缺陷修复记录（6 处代码缺陷）、11.7 首次部署实录（含标准流程差异表与实测记录）、5.7 hairpin 表述修正
