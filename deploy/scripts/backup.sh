#!/usr/bin/env bash
# 沙箱运行时适配：手动安装的 docker 与非默认 daemon socket
export PATH=/opt/docker-pkg/usr/bin:$PATH
export DOCKER_HOST=unix:///root/.cache/docker-engine/var/docker.sock
# compose 插件安装在 DOCKER_CONFIG 对应目录，不设置则 docker compose 子命令不可用（2026-10-20 发版事故教训）
export DOCKER_CONFIG=/root/.cache/docker-cli
# 语图每日备份：PG 全库 + uploads，保留 14 天
set -euo pipefail
BACKUP_DIR=/root/.cache/yutu-runtime/backup
TS=$(date +%Y%m%d-%H%M%S)
KEEP_DAYS=14
mkdir -p "$BACKUP_DIR"

# 1) 数据库（pg_dump 自定义格式）
docker exec yutu-postgres pg_dump -U yutu -d flowchart_editor -Fc -f "/tmp/yutu-db-$TS.dump"
docker cp "yutu-postgres:/tmp/yutu-db-$TS.dump" "$BACKUP_DIR/yutu-db-$TS.dump"
docker exec yutu-postgres rm "/tmp/yutu-db-$TS.dump"

# 2) uploads
tar -czf "$BACKUP_DIR/yutu-uploads-$TS.tar.gz" -C /root/.cache/yutu-runtime uploads

# 3) 轮转
find "$BACKUP_DIR" -name 'yutu-db-*.dump'      -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'yutu-uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete

echo "[$(date '+%F %T')] 备份完成: yutu-db-$TS.dump ($(du -h "$BACKUP_DIR/yutu-db-$TS.dump" | cut -f1)), yutu-uploads-$TS.tar.gz ($(du -h "$BACKUP_DIR/yutu-uploads-$TS.tar.gz" | cut -f1))"
