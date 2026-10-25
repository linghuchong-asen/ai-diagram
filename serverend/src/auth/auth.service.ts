import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserEntity } from 'src/user/entities/user.entity';
import { hashToken, TokenStore, TOKEN_STORE } from './token.store';
import { Inject } from '@nestjs/common';

/** JWT 默认有效期(与 AuthModule jwtModule.signOptions 保持一致):24h */
const TOKEN_TTL_FALLBACK_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AuthService {
  constructor(
    private jwtService: JwtService,
    /* Task 11.3:令牌态存储(默认 PG auth_tokens 表),登出/主动失效走这里 */
    @Inject(TOKEN_STORE) private readonly tokenStore: TokenStore,
  ) {}

  createToken(user: Partial<UserEntity>) {
    return this.jwtService.sign(user, {});
  }

  async getToken(user: Partial<UserEntity>) {
    /* console.log('用于生成token的user信息', user.id, user.username); */
    const token = this.createToken({
      id: user.id,
      username: user.username,
    });
    // Task 11.3:同步登记令牌态(PG auth_tokens 表,只存 sha256 摘要),支持登出主动失效
    try {
      const payload = this.jwtService.decode(token) as { id?: string; exp?: number } | null;
      if (payload?.id) {
        await this.tokenStore.save({
          tokenHash: hashToken(token),
          userId: String(payload.id),
          expiresAt: payload.exp ? payload.exp * 1000 : Date.now() + TOKEN_TTL_FALLBACK_MS,
        });
      }
    } catch {
      // 令牌态登记失败不阻断登录:JWT 签名校验仍兜底(TokenStore.save 内部也已吞异常)
    }
    return token;
  }

  /** 登出:吊销当前令牌(Task 11.3)。token 为明文 JWT,存储侧只留摘要 */
  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.tokenStore.revoke(hashToken(token));
  }

  /** JwtStrategy 每次请求校验令牌是否已被吊销 */
  async isTokenRevoked(token: string): Promise<boolean> {
    if (!token) return false;
    return this.tokenStore.isRevoked(hashToken(token));
  }
}
