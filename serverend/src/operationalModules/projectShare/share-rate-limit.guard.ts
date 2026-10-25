// 语图 V1.1 - 公开分享读取限流（免登录端点防滥用）。
// 背景：GET /share/view/:token 无需登录即可访问（分享传播的前提），
// 存在被脚本遍历 token / 恶意刷流量的风险。
// 策略（与 auth-rate-limit.guard 同款模式：进程内 Map + 固定窗口 + 429）：
//   分享浏览  share:<ip>  10 分钟内最多 120 次（正常浏览远低于此；只读放宽于登录）
// token 本身 128 bit 随机，穷举不可行，限流主要防高频抓取与 CC。
// 注意：进程内计数，重启即清零 —— 公测期单实例可接受；多实例时需换 Redis。
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
const SHARE_VIEW_MAX = 120;
/** 记录数上限（防 Map 无界增长；触发时清理全部过期窗口） */
const MAX_TRACKED_KEYS = 20000;

/**
 * 分享读取限流守卫。
 * 经验教训（首次部署记录）：守卫必须显式声明 @Injectable()，
 * 否则 Nest 无法实例化，所有挂载路由会 500。
 */
@Injectable()
export class ShareRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitRecord>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `share:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;

    const now = Date.now();
    const hit = this.hits.get(key);

    if (!hit || hit.resetAt <= now) {
      // 新窗口（或旧窗口已过期）：重置计数
      this.sweepExpired(now);
      this.hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    hit.count += 1;
    if (hit.count > SHARE_VIEW_MAX) {
      const retryInSec = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      throw new HttpException(
        {
          code: 'SHARE_RATE_LIMITED',
          message: `访问过于频繁，请 ${retryInSec} 秒后再试`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  /** Map 过大时清理过期窗口（正常流量下不会触发，纯防御） */
  private sweepExpired(now: number): void {
    if (this.hits.size < MAX_TRACKED_KEYS) return;
    for (const [key, record] of this.hits) {
      if (record.resetAt <= now) this.hits.delete(key);
    }
  }
}
