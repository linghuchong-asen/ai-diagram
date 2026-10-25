#!/usr/bin/env bash
# 沙箱运行时适配：手动安装的 docker 与非默认 daemon socket
export PATH=/opt/docker-pkg/usr/bin:$PATH
export DOCKER_HOST=unix:///root/.cache/docker-engine/var/docker.sock
# compose 插件安装在 DOCKER_CONFIG 对应目录，不设置则 docker compose 子命令不可用（2026-10-20 发版事故教训）
export DOCKER_CONFIG=/root/.cache/docker-cli
# 语图发版：构建新镜像 → 更新运行目录 → 滚动更新 → 健康验证 → 失败自动回退
# 运行时根路径与 deploy/docker-compose.yml、运维手册保持一致（/root/.cache/yutu-runtime）
set -euo pipefail

REPO_DIR=/root/workspace/ai-diagram
APP_DIR=/root/.cache/yutu-runtime/app
LOG=/root/.cache/yutu-runtime/logs/deploy.log
NOTE=${1:-常规发版}

dc() { docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env.prod" "$@"; }
log(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

cd "$REPO_DIR"
TAG=$(date +%Y%m%d-%H%M)

log "== 发版开始 tag=$TAG 备注=$NOTE"

log "== 1/6 构建后端镜像"
docker build -f deploy/Dockerfile.backend -t "yutu-backend:$TAG" -t yutu-backend:latest .

log "== 2/6 构建前端镜像"
docker build -f deploy/Dockerfile.frontend -t "yutu-frontend:$TAG" -t yutu-frontend:latest .

log "== 3/6 同步工件"
rsync -a --delete --exclude='.env.prod' "$REPO_DIR/deploy/" "$APP_DIR/"
chmod +x "$APP_DIR"/scripts/*.sh

log "== 4/6 记录并切换镜像 tag"
PREV=$(grep -E '^YUTU_BACKEND_TAG=' "$APP_DIR/.env.prod" | cut -d= -f2)
sed -i "s|^YUTU_BACKEND_TAG=.*|YUTU_BACKEND_TAG=$TAG|"  "$APP_DIR/.env.prod"
sed -i "s|^YUTU_FRONTEND_TAG=.*|YUTU_FRONTEND_TAG=$TAG|" "$APP_DIR/.env.prod"
echo "$TAG $(date '+%F %T') $NOTE" >> "$APP_DIR/VERSIONS"

log "== 5/6 滚动更新容器"
dc up -d

# 显式校验：运行中容器镜像必须是本次 tag（防 compose 静默失败导致"假发版成功"）
run_tag=$(docker inspect -f '{{.Config.Image}}' yutu-backend 2>/dev/null || echo missing)
if [ "$run_tag" != "yutu-backend:$TAG" ]; then
  log "== 验证失败！运行中镜像为 $run_tag，期望 yutu-backend:$TAG（compose 未生效？）"
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    sed -i "s|^YUTU_BACKEND_TAG=.*|YUTU_BACKEND_TAG=$PREV|"  "$APP_DIR/.env.prod"
    sed -i "s|^YUTU_FRONTEND_TAG=.*|YUTU_FRONTEND_TAG=$PREV|" "$APP_DIR/.env.prod"
    dc up -d
    log "== 已回退到 $PREV，请查 docker compose 配置/环境"
  fi
  exit 1
fi

log "== 6/6 健康验证（最长等待 150 秒）"
ok=0
for i in $(seq 1 15); do
  sleep 10
  b=$(docker inspect -f '{{.State.Health.Status}}' yutu-backend 2>/dev/null || echo starting)
  n=$(docker inspect -f '{{.State.Health.Status}}' yutu-nginx   2>/dev/null || echo starting)
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/ || echo 000)
  # 商业化首发起增加专用存活探针（SELECT 1 探 DB）
  health=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/health || echo 000)
  if [ "$b" = healthy ] && [ "$n" = healthy ] && [ "$api" = 200 ] && [ "$health" = 200 ]; then ok=1; break; fi
  log "   第${i}次探测: backend=$b nginx=$n api=$api health=$health"
done

if [ "$ok" = 1 ]; then
  log "== 发版成功 tag=$TAG（上一版本 $PREV 已保留可回滚）"
  # 发版成功后清理过时镜像：保留 latest、当前 tag 与上一版本，其余后端镜像删除（回滚目标外无保留价值）
  docker images --format '{{.Repository}}:{{.Tag}}' | grep -E '^yutu-backend:' | \
    grep -Ev "(:latest|:$TAG|:$PREV)$" | xargs -r docker rmi 2>/dev/null || true
else
  log "== 验证失败！自动回退到上一版本 $PREV"
  if [ -n "$PREV" ] && [ "$PREV" != "$TAG" ]; then
    sed -i "s|^YUTU_BACKEND_TAG=.*|YUTU_BACKEND_TAG=$PREV|"  "$APP_DIR/.env.prod"
    sed -i "s|^YUTU_FRONTEND_TAG=.*|YUTU_FRONTEND_TAG=$PREV|" "$APP_DIR/.env.prod"
    dc up -d
    log "== 已回退到 $PREV，请查 docker logs yutu-backend 定位失败原因"
  else
    log "== 无上一版本可回退，保持现状，请人工介入"
  fi
  exit 1
fi
