// 语图商业化首发加固：登录/注册接口进程内限流（无 Redis 依赖，单实例部署够用）。
// 背景：公开上线后登录接口存在爆破风险、注册接口存在批量刷号风险（用户体系仅有账密）。
// 策略（滑动窗口内计数，按首次命中时刻起算固定窗口）：
//   登录  login:<ip>:<username>  10 分钟内最多 10 次（覆盖输错密码的正常重试空间）
//   注册  reg:<ip>              10 分钟内最多 5 次
// 超限返回 429 + 明确等待秒数；窗口过期惰性重置；Map 超上限时清理过期项防无界增长。
// 注意：进程内计数，重启即清零 —— 对公测期单实例可接受；多实例时需换 Redis 实现。
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import type { Request } from 'express';

interface HitRecord {
  count: number;
  resetAt: number;
}

/** 限流窗口（毫秒）与阈值 */
const WINDOW_MS = 10 * 60 * 1000;
const LOGIN_MAX = 10;
const REGISTER_MAX = 5;
/** 记录数上限（防 Map 无界增长；触发时清理全部过期窗口） */
const MAX_TRACKED_KEYS = 20000;

/**
 * 登录/注册限流守卫。
 * 经验教训（首次部署记录）：守卫必须显式声明 @Injectable()，
 * 否则 Nest 无法实例化，所有挂载路由会 500。
 */
@Injectable()
export class AuthRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitRecord>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const path = String(req.path ?? req.url ?? '');
    const isRegister = path.includes('register');
    const max = isRegister ? REGISTER_MAX : LOGIN_MAX;
    const key = this.keyOf(req, isRegister);

    const now = Date.now();
    const hit = this.hits.get(key);

    if (!hit || hit.resetAt <= now) {
      // 新窗口（或旧窗口已过期）：重置计数
      this.sweepExpired(now);
      this.hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    hit.count += 1;
    if (hit.count > max) {
      const retryInSec = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      throw new HttpException(
        {
          code: 'AUTH_RATE_LIMITED',
          message: `尝试过于频繁，请 ${retryInSec} 秒后再试`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** 限流键：登录按 IP+用户名（定向爆破与撞库都拦得住），注册按 IP（防批量刷号） */
  private keyOf(req: Request, isRegister: boolean): string {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';
    const body = (req.body ?? {}) as { username?: unknown };
    const username =
      typeof body.username === 'string' ? body.username.trim().toLowerCase() : '';
    return isRegister ? `reg:${ip}` : `login:${ip}:${username}`;
  }

  /** Map 过大时清理过期窗口（正常流量下不会触发，纯防御） */
  private sweepExpired(now: number): void {
    if (this.hits.size < MAX_TRACKED_KEYS) return;
    for (const [key, record] of this.hits) {
      if (record.resetAt <= now) this.hits.delete(key);
    }
  }
}
