// 语图商业化首发 - 免登录试用限流(Task 3)。
// 背景:POST /ai/trial/chat 无需登录即可访问(增长转化的关键入口),
// 存在被脚本高频刷 LLM 成本的风险(配合服务内 trialId/IP/全局台账形成四层防线)。
// 策略(与 share-rate-limit.guard / auth-rate-limit.guard 同款模式:
//   进程内 Map + 固定窗口 + 429 + sweepExpired 防膨胀):
//   试用请求  trial:<ip>  10 分钟内最多 5 次(正常访客一次试用远低于此)
// 注意:进程内计数,重启即清零 —— 公测期单实例可接受;多实例时需换 Redis。
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
const TRIAL_MAX = 5;
/** 记录数上限（防 Map 无界增长；触发时清理全部过期窗口） */
const MAX_TRACKED_KEYS = 20000;

/**
 * 免登录试用限流守卫。
 * 经验教训（首次部署记录）：守卫必须显式声明 @Injectable()，
 * 否则 Nest 无法实例化，所有挂载路由会 500。
 */
@Injectable()
export class TrialRateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, HitRecord>();

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    const key = `trial:${req.ip ?? req.socket?.remoteAddress ?? 'unknown'}`;

    const now = Date.now();
    const hit = this.hits.get(key);

    if (!hit || hit.resetAt <= now) {
      // 新窗口（或旧窗口已过期）：重置计数
      this.sweepExpired(now);
      this.hits.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return true;
    }

    hit.count += 1;
    if (hit.count > TRIAL_MAX) {
      throw new HttpException(
        {
          code: 'TRIAL_RATE_LIMITED',
          message: '操作过于频繁，请稍后再试',
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
