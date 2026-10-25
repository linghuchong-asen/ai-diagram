#!/usr/bin/env bash
# 沙箱运行时适配：手动安装的 docker 与非默认 daemon socket
export PATH=/opt/docker-pkg/usr/bin:$PATH
export DOCKER_HOST=unix:///root/.cache/docker-engine/var/docker.sock
# compose 插件安装在 DOCKER_CONFIG 对应目录，不设置则 docker compose 子命令不可用（2026-10-20 发版事故教训）
export DOCKER_CONFIG=/root/.cache/docker-cli
# 语图每日巡检：全部通过输出 [ OK ]，异常输出 [FAIL]（grep FAIL 快速定界）
# 商业化首发增强：新增 /api/health 存活探针检查与 swap 深度使用检查
set -uo pipefail
say(){ echo "$1 $2"; }
ok(){ say "[ OK ]" "$*"; }
fail(){ say "[FAIL]" "$*"; }

echo "==== 语图巡检 $(date '+%F %T') ===="

# 1) 容器状态与健康
for c in yutu-postgres yutu-backend yutu-nginx; do
  st=$(docker inspect -f '{{.State.Status}}' $c 2>/dev/null || echo missing)
  h=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}n/a{{end}}' $c 2>/dev/null)
  [ "$st" = running ] && [ "$h" != unhealthy ] && ok "$c 运行中 (health=$h)" || fail "$c 状态异常: $st/$h"
done

# 2) 磁盘
usage=$(df / | awk 'NR==2{gsub("%","");print $5}')
[ "$usage" -lt 85 ] && ok "磁盘使用 ${usage}%" || fail "磁盘使用 ${usage}% ≥85%，需清理"

# 3) 内存 + swap（机器仅 3.6G 内存，swap 深度使用是 OOM 前兆，纳入巡检）
free -m | awk 'NR==2{printf "%s 内存: %sMB/%sMB\n",($2-$7>3000?"[FAIL]":"[ OK ]"),$3,$2}'
swap_used=$(free -m | awk '/^Swap:/{print $3}')
swap_total=$(free -m | awk '/^Swap:/{print $2}')
[ -n "$swap_used" ] && [ "$swap_used" -lt 3200 ] && ok "swap 使用 ${swap_used}MB/${swap_total}MB" || fail "swap 使用 ${swap_used}MB/${swap_total}MB 接近耗尽（内存吃紧，需关注）"

# 4) PostgreSQL 连通 + 核心表存在
if tables=$(docker exec yutu-postgres psql -U yutu -d flowchart_editor -tAc \
  "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null) && [ "${tables:-0}" -ge 10 ]; then
  ok "PG 连通，public 表数量: $tables"
else
  fail "PG 连接失败或表数量异常: ${tables:-无}"
fi

# 5) 后端 API
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/ || echo 000)
[ "$code" = 200 ] && ok "后端 API HTTP 200" || fail "后端 API HTTP $code"

# 5b) 存活探针（SELECT 1 探 DB；非 200 说明 DB 连接异常，早于业务报错发现）
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/health || echo 000)
[ "$code" = 200 ] && ok "存活探针 /api/health HTTP 200" || fail "存活探针 /api/health HTTP $code（DB 可能不可用）"

# 5c) 公开分享端点（V1.1 免登录只读分享）：伪造 token 期待 404 —— 404/429 说明
# 路由已注册且守卫生效；502/503/000 说明后端未部署该端点或进程异常
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/share/view/inspect-probe-token || echo 000)
case "$code" in
  404|429) ok "公开分享端点 /api/share/view 可达（HTTP $code，路由已注册）" ;;
  *) fail "公开分享端点 /api/share/view HTTP $code（预期 404/429；502/000 说明 V1.1 后端未生效）" ;;
esac

# 5d) 按次付费解锁端点（Task 6）：无 Authorization 访问鉴权下单端点期待 401 ——
# 401 说明路由已注册且 JwtAuthGuard 生效；404/502/503/000 说明后端未部署该模块或进程异常
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST http://127.0.0.1/api/billing/unlock/1 || echo 000)
case "$code" in
  401) ok "解锁下单端点 /api/billing/unlock 已注册（HTTP 401，守卫生效）" ;;
  *) fail "解锁下单端点 /api/billing/unlock HTTP $code（预期 401；404/502/000 说明 Task 6 后端未生效）" ;;
esac

# 5e) 免登录试用端点（Task 3）：空 JSON body 缺少合法 trialId，期待 400 ——
# 只探测路由与参数校验，绝不携带合法 trialId，避免真实 AI 生成消耗配额；
# 400 = 路由已注册且校验生效；429 = 触发 IP 限流（路由同样存活）；5xx/404/000 视为异常
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 -X POST \
  -H 'Content-Type: application/json' -d '{}' http://127.0.0.1/api/ai/trial/chat || echo 000)
case "$code" in
  400) ok "试用端点 /api/ai/trial/chat 已注册（HTTP 400，参数校验生效）" ;;
  429) ok "试用端点 /api/ai/trial/chat 已注册（HTTP 429，限流生效）" ;;
  *) fail "试用端点 /api/ai/trial/chat HTTP $code（预期 400/429；404/5xx/000 说明 Task 3 后端未生效）" ;;
esac

# 5f) 模板中心列表（Task 7）：公开只读端点期待 200 ——
# 静态模板无 DB/AI 调用，探活不产生脏数据与配额消耗
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/api/template/list || echo 000)
[ "$code" = 200 ] && ok "模板列表 /api/template/list HTTP 200" || fail "模板列表 /api/template/list HTTP $code（预期 200）"

# 注意：/api/billing/notify/xunhupay 是支付回调，带 body 会尝试验签/改单，可能误触发业务；
# 这里刻意不做探针。其路由存活性由 5d（billing 模块已加载）与真实支付自测间接覆盖。

# 6) 前端
code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 http://127.0.0.1/ || echo 000)
[ "$code" = 200 ] && ok "前端首页 HTTP 200" || fail "前端首页 HTTP $code"

# 7) 近 24h 应用错误量
today=/root/.cache/yutu-runtime/logs/$(date +%F)
errs=$(grep -c ERROR "$today/error.log" 2>/dev/null || echo 0)
[ "$errs" -lt 50 ] && ok "当日应用 ERROR $errs 条" || fail "当日应用 ERROR $errs 条，需人工检查 $today/error.log"

# 8) 备份新鲜度
latest=$(find /root/.cache/yutu-runtime/backup -name 'yutu-db-*.dump' -printf '%T@ %p\n' 2>/dev/null | sort -rn | head -1 | cut -d' ' -f2-)
if [ -n "$latest" ]; then
  age=$(( ($(date +%s) - $(stat -c %Y "$latest")) / 86400 ))
  [ "$age" -le 1 ] && ok "最近备份 ${age} 天前: $latest" || fail "最近备份已 ${age} 天未更新"
else
  fail "未发现数据库备份"
fi

# 9) 容器异常重启检测
for c in yutu-postgres yutu-backend yutu-nginx; do
  n=$(docker inspect -f '{{.RestartCount}}' $c 2>/dev/null || echo 0)
  [ "$n" -lt 3 ] || fail "$c 已自动重启 ${n} 次（疑似崩溃循环）"
done

echo "==== 巡检结束 ===="
