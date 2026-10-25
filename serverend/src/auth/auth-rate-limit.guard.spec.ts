// 语图商业化首发：登录/注册限流守卫单测（纯逻辑，不依赖 Nest TestingModule）
import { ExecutionContext, HttpException, HttpStatus } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';

/** 最小化 ExecutionContext 桩：guard 只读 req.path / req.ip / req.body.username */
function makeContext(path: string, ip: string, username: string): ExecutionContext {
  const req = {
    path,
    ip,
    body: username ? { username } : {},
    socket: { remoteAddress: ip },
  } as never;
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
}

describe('AuthRateLimitGuard（商业化首发：登录/注册限流）', () => {
  let guard: AuthRateLimitGuard;

  beforeEach(() => {
    guard = new AuthRateLimitGuard();
  });

  it('登录：同 IP+用户名 10 分钟窗口内前 10 次放行', () => {
    for (let i = 1; i <= 10; i += 1) {
      expect(guard.canActivate(makeContext('/auth/login', '1.1.1.1', 'alice'))).toBe(true);
    }
  });

  it('登录：第 11 次抛 429，提示信息含等待秒数', () => {
    for (let i = 0; i < 10; i += 1) {
      guard.canActivate(makeContext('/auth/login', '2.2.2.2', 'bob'));
    }
    expect(() => guard.canActivate(makeContext('/auth/login', '2.2.2.2', 'bob'))).toThrow(
      HttpException,
    );
    try {
      guard.canActivate(makeContext('/auth/login', '2.2.2.2', 'bob'));
      throw new Error('应当抛出 HttpException');
    } catch (e) {
      const err = e as HttpException;
      expect(err.getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
      const body = err.getResponse() as { code: string; message: string };
      expect(body.code).toBe('AUTH_RATE_LIMITED');
      expect(body.message).toContain('秒后再试');
    }
  });

  it('登录：不同用户名互不影响（单用户计数不应拦住其他用户）', () => {
    for (let i = 0; i < 10; i += 1) {
      guard.canActivate(makeContext('/auth/login', '3.3.3.3', 'carol'));
    }
    expect(guard.canActivate(makeContext('/auth/login', '3.3.3.3', 'dave'))).toBe(true);
  });

  it('登录：不同 IP 互不影响（NAT 场景不过度误伤）', () => {
    for (let i = 0; i < 10; i += 1) {
      guard.canActivate(makeContext('/auth/login', '4.4.4.4', 'erin'));
    }
    expect(guard.canActivate(makeContext('/auth/login', '5.5.5.5', 'erin'))).toBe(true);
  });

  it('注册：同 IP 第 6 次抛 429（阈值 5 次防批量刷号）', () => {
    for (let i = 0; i < 5; i += 1) {
      expect(guard.canActivate(makeContext('/user/register', '6.6.6.6', 'newuser'))).toBe(true);
    }
    expect(() => guard.canActivate(makeContext('/user/register', '6.6.6.6', 'newuser'))).toThrow(
      HttpException,
    );
  });

  it('注册：用户名不同但同 IP 共享计数窗口', () => {
    for (let i = 0; i < 5; i += 1) {
      guard.canActivate(makeContext('/user/register', '7.7.7.7', `user-${i}`));
    }
    expect(() => guard.canActivate(makeContext('/user/register', '7.7.7.7', 'user-6'))).toThrow(
      HttpException,
    );
  });
});
