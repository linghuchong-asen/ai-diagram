#!/usr/bin/env bash
# 沙箱运行时适配：手动安装的 docker 与非默认 daemon socket
export PATH=/opt/docker-pkg/usr/bin:$PATH
export DOCKER_HOST=unix:///root/.cache/docker-engine/var/docker.sock
# compose 插件安装在 DOCKER_CONFIG 对应目录，不设置则 docker compose 子命令不可用（2026-10-20 发版事故教训）
export DOCKER_CONFIG=/root/.cache/docker-cli
# 语图回滚：回退到指定历史 tag（默认上一个版本）
set -euo pipefail
APP_DIR=/root/.cache/yutu-runtime/app
LOG=/root/.cache/yutu-runtime/logs/deploy.log
dc() { docker compose --project-directory "$APP_DIR" --env-file "$APP_DIR/.env.prod" "$@"; }
log(){ echo "[$(date '+%F %T')] $*" | tee -a "$LOG"; }

TARGET=${1:-}
cd "$APP_DIR"
if [ -z "$TARGET" ]; then
  # 取当前 tag 在 VERSIONS 中的上一条
  CUR=$(grep -E '^YUTU_BACKEND_TAG=' .env.prod | cut -d= -f2)
  TARGET=$(grep -E '^[0-9]{8}-[0-9]{4} ' VERSIONS | awk '{print $1}' | grep -vx "$CUR" | tail -1)
fi
[ -n "$TARGET" ] || { log "无可回滚版本"; exit 1; }
docker image inspect "yutu-backend:$TARGET"  >/dev/null 2>&1 || { log "镜像 yutu-backend:$TARGET 不存在"; exit 1; }
docker image inspect "yutu-frontend:$TARGET" >/dev/null 2>&1 || { log "镜像 yutu-frontend:$TARGET 不存在"; exit 1; }

log "== 回滚开始 -> $TARGET"
sed -i "s|^YUTU_BACKEND_TAG=.*|YUTU_BACKEND_TAG=$TARGET|"  .env.prod
sed -i "s|^YUTU_FRONTEND_TAG=.*|YUTU_FRONTEND_TAG=$TARGET|" .env.prod
dc up -d

ok=0
for i in $(seq 1 15); do
  sleep 10
  api=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/ || echo 000)
  b=$(docker inspect -f '{{.State.Health.Status}}' yutu-backend 2>/dev/null || echo starting)
  [ "$api" = 200 ] && [ "$b" = healthy ] && { ok=1; break; }
done
[ "$ok" = 1 ] && log "== 回滚成功: $TARGET" || { log "== 回滚后验证未通过，人工检查"; exit 1; }
