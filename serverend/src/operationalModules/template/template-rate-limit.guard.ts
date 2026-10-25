// 语图 Task 7 - 模板中心限流（公开端点防滥用）。
// 背景：GET /template/list 无需登录即可访问（访客/新用户进入模板中心的首要入口），
// 存在被脚本高频刷流量的风险（纯静态数据无 DB 压力，主要是带宽与日志噪音）。
// 策略（与 share-rate-limit.guard 同款模式：进程内 Map + 固定窗口 + 429）：
//   模板列表  template:<ip>  10 分钟内最多 60 次（正常浏览远低于此）
// 注意：进程内计数，重启即清零 —— 公测期单实例可接受;多实例时需换 Redis。
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
const TEMPLATE_LIST_MAX = 60;
/** 记录数上限（防 Map 无界增长；触发时清理全部过期窗口） */
const MAX_TRACKED_KEYS = 20000;

/**
 * 模板列表限流守卫。
 * 经验教训（首次部署记录）：守卫必须显式声明 @Injectable()，
 * 否则 Nest 无法实例化，所有挂载路由会 500。
 */
@Injectable()
export class TemplateRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitRecord>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `template:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;

    const now = Date.now();
    const hit = this.hits.get(key);

    if (!hit || hit.resetAt <= now) {
      // 新窗口（或旧窗口已过期）：重置计数
      this.sweepExpired(now);
      this.hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    hit.count += 1;
    if (hit.count > TEMPLATE_LIST_MAX) {
      const retryInSec = Math.max(1, Math.ceil((hit.resetAt - now) / 1000));
      throw new HttpException(
        {
          code: 'TEMPLATE_RATE_LIMITED',
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
