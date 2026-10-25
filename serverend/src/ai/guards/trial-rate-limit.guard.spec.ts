// 语图商业化首发 - 免登录试用限流守卫单测(Task 3)
// 覆盖:5 次/10 分钟窗口边界(第 5 次过、第 6 次 429)、不同 IP 独立计数、429 响应体契约
import { HttpException } from '@nestjs/common';
import { TrialRateLimitGuard } from './trial-rate-limit.guard';

function makeContext(ip: string) {
  return {
    // ExecutionContext 契约:switchToHttp() 返回宿主,宿主.getRequest() 返回请求对象
    switchToHttp: () => ({ getRequest: () => ({ ip, socket: { remoteAddress: ip } }) }),
  } as never;
}

describe('TrialRateLimitGuard（免登录试用限流,Task 3）', () => {
  it('同 IP 10 分钟内 5 次放行,第 6 次 429 TRIAL_RATE_LIMITED', () => {
    const guard = new TrialRateLimitGuard();
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(makeContext('1.2.3.4'))).toBe(true);
    }
    expect(() => guard.canActivate(makeContext('1.2.3.4'))).toThrow(HttpException);
    try {
      guard.canActivate(makeContext('1.2.3.4'));
      throw new Error('应当抛出 HttpException');
    } catch (e) {
      const err = e as HttpException;
      expect(err.getStatus()).toBe(429);
      expect(err.getResponse()).toMatchObject({
        code: 'TRIAL_RATE_LIMITED',
        message: '操作过于频繁，请稍后再试',
      });
    }
  });

  it('不同 IP 独立计数:A 触发限流不影响 B 放行', () => {
    const guard = new TrialRateLimitGuard();
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(makeContext('9.9.9.9'))).toBe(true);
    }
    expect(() => guard.canActivate(makeContext('9.9.9.9'))).toThrow(HttpException); // A 第 6 次限流
    expect(guard.canActivate(makeContext('8.8.8.8'))).toBe(true); // B 独立计数照常放行
  });

  it('窗口过期后重置(模拟 resetAt 已过期)', () => {
    const guard = new TrialRateLimitGuard();
    for (let i = 0; i < 5; i++) {
      expect(guard.canActivate(makeContext('7.7.7.7'))).toBe(true);
    }
    // 直接篡改内部记录的 resetAt 模拟 10 分钟窗口过期 → 下一请求开新窗口放行
    const hits = (guard as unknown as { hits: Map<string, { resetAt: number }> }).hits;
    const rec = hits.get('trial:7.7.7.7')!;
    rec.resetAt = Date.now() - 1;
    expect(guard.canActivate(makeContext('7.7.7.7'))).toBe(true);
  });
});
