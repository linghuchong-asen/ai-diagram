// 语图 V1.1：分享读取限流守卫单测（纯逻辑，不依赖 Nest TestingModule）
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { ShareRateLimitGuard } from './share-rate-limit.guard';

/** 最小化 ExecutionContext 桩：guard 只读 req.ip / req.socket.remoteAddress */
function makeContext(ip: string): ExecutionContext {
  const req = {
    path: '/share/view/abc',
    ip,
    socket: { remoteAddress: ip },
  } as never;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('ShareRateLimitGuard（V1.1：公开分享读取限流）', () => {
  let guard: ShareRateLimitGuard;

  beforeEach(() => {
    guard = new ShareRateLimitGuard();
  });

  it('同 IP 10 分钟窗口内前 120 次放行（只读浏览放宽阈值）', () => {
    for (let i = 1; i <= 120; i += 1) {
      expect(guard.canActivate(makeContext('1.1.1.1'))).toBe(true);
    }
  });

  it('第 121 次抛 429，提示信息含等待秒数', () => {
    for (let i = 0; i < 120; i += 1) {
      guard.canActivate(makeContext('2.2.2.2'));
    }
    expect(() => guard.canActivate(makeContext('2.2.2.2'))).toThrow(HttpException);
    try {
      guard.canActivate(makeContext('2.2.2.2'));
      throw new Error('应当抛出 HttpException');
    } catch (e) {
      const err = e as HttpException;
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = err.getResponse() as { code: string; message: string };
      expect(body.code).toBe('SHARE_RATE_LIMITED');
      expect(body.message).toContain('秒后再试');
    }
  });

  it('不同 IP 互不影响（分享传播到多个访客时不过度误伤）', () => {
    for (let i = 0; i < 120; i += 1) {
      guard.canActivate(makeContext('3.3.3.3'));
    }
    expect(guard.canActivate(makeContext('4.4.4.4'))).toBe(true);
  });
});
