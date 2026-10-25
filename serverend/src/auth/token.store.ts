// 语图技术方案 - 令牌态存储(Task 11.3)
// 文档(backend/auth.md):登录签发 JWT 的同时写入「令牌态」,支持登出主动失效;
// 安全(security.md):服务端只存 token 摘要(sha256),不落明文。
// 实现:
//   - PgTokenStore(默认):auth_tokens 表,PG 单库一身多职,不引入新基础设施;
//   - InMemoryTokenStore:单测/本地兜底(TOKEN_STORE=memory 时启用)。
// 说明:Redis 实现仅在 ioredis 进入依赖后才允许(当前未安装,按规格不装包、不实现);
//       硬约束见任务规格——不引入任何新基础设施依赖。
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import * as crypto from 'crypto';
import { AuthTokenEntity } from './entities/auth-token.entity';

/** 令牌态记录(调用方只给摘要,不给明文) */
export interface TokenRecord {
  tokenHash: string;
  userId: string;
  /** 过期时间(毫秒时间戳) */
  expiresAt: number;
}

export interface TokenStore {
  /** 登录成功后登记令牌态 */
  save(record: TokenRecord): Promise<void>;
  /** 登出/主动失效:吊销单个令牌 */
  revoke(tokenHash: string): Promise<void>;
  /** 吊销某用户全部令牌(改密/封禁场景) */
  revokeAllForUser(userId: string): Promise<void>;
  /** 是否已吊销(JwtStrategy 每次请求校验) */
  isRevoked(tokenHash: string): Promise<boolean>;
}

export const TOKEN_STORE = 'TOKEN_STORE';

/** 令牌摘要:sha256(服务端不落明文 JWT) */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(String(token ?? '')).digest('hex');
}

// ---------- PG 实现(默认) ----------
export class PgTokenStore implements TokenStore {
  private readonly logger = new Logger(PgTokenStore.name);

  constructor(private readonly repo: Repository<AuthTokenEntity>) {}

  async save(record: TokenRecord): Promise<void> {
    try {
      await this.repo.save(
        this.repo.create({
          tokenHash: record.tokenHash,
          userId: record.userId,
          expiresAt: record.expiresAt,
          revokedAt: null,
        } as Partial<AuthTokenEntity>) as AuthTokenEntity,
      );
    } catch (err) {
      // 令牌态写入失败不阻断登录(JWT 本身仍有效),但记录告警便于发现存储故障
      this.logger.warn(`令牌态写入失败: ${(err as Error)?.message ?? err}`);
    }
  }

  async revoke(tokenHash: string): Promise<void> {
    if (!tokenHash) return;
    await this.repo.update({ tokenHash }, { revokedAt: new Date() });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    if (!userId) return;
    await this.repo.update({ userId, revokedAt: null as any }, { revokedAt: new Date() });
  }

  async isRevoked(tokenHash: string): Promise<boolean> {
    if (!tokenHash) return false;
    const row = await this.repo.findOne({ where: { tokenHash } });
    if (!row) return false; // 旧令牌(未登记令牌态)保持兼容:由 JWT 签名校验兜底
    return row.revokedAt != null;
  }
}

// ---------- 内存实现(单测/本地兜底) ----------
export class InMemoryTokenStore implements TokenStore {
  private readonly rows = new Map<string, TokenRecord & { revoked: boolean }>();

  async save(record: TokenRecord): Promise<void> {
    this.rows.set(record.tokenHash, { ...record, revoked: false });
  }

  async revoke(tokenHash: string): Promise<void> {
    const row = this.rows.get(tokenHash);
    if (row) row.revoked = true;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    for (const row of this.rows.values()) {
      if (row.userId === userId) row.revoked = true;
    }
  }

  async isRevoked(tokenHash: string): Promise<boolean> {
    return this.rows.get(tokenHash)?.revoked ?? false;
  }
}
