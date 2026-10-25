// 语图技术方案 - 令牌态存储单测(Task 11.3)
// 覆盖:登记/吊销/批量吊销/吊销校验、sha256 摘要稳定性、未登记令牌保持兼容(不判吊销)
import { InMemoryTokenStore, PgTokenStore, hashToken } from './token.store';
import { AuthTokenEntity } from './entities/auth-token.entity';

describe('hashToken', () => {
  it('输出 sha256 十六进制(64 位),同输入同输出', () => {
    const h1 = hashToken('abc');
    const h2 = hashToken('abc');
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[a-f0-9]{64}$/);
    expect(h1).not.toBe(hashToken('abd'));
  });

  it('不泄露明文 token', () => {
    const token = 'Bearer-header-value.jwt.payload';
    expect(hashToken(token)).not.toContain(token);
  });
});

describe('InMemoryTokenStore', () => {
  it('save → isRevoked=false;revoke → true', async () => {
    const store = new InMemoryTokenStore();
    const h = hashToken('token-1');
    await store.save({ tokenHash: h, userId: 'u1', expiresAt: Date.now() + 1000 });
    expect(await store.isRevoked(h)).toBe(false);
    await store.revoke(h);
    expect(await store.isRevoked(h)).toBe(true);
  });

  it('revokeAllForUser 吊销该用户全部令牌,不影响他人', async () => {
    const store = new InMemoryTokenStore();
    const h1 = hashToken('token-u1-a');
    const h2 = hashToken('token-u1-b');
    const h3 = hashToken('token-u2');
    await store.save({ tokenHash: h1, userId: 'u1', expiresAt: 0 });
    await store.save({ tokenHash: h2, userId: 'u1', expiresAt: 0 });
    await store.save({ tokenHash: h3, userId: 'u2', expiresAt: 0 });

    await store.revokeAllForUser('u1');
    expect(await store.isRevoked(h1)).toBe(true);
    expect(await store.isRevoked(h2)).toBe(true);
    expect(await store.isRevoked(h3)).toBe(false);
  });

  it('未登记的令牌不判吊销(旧令牌兼容,由 JWT 签名校验兜底)', async () => {
    const store = new InMemoryTokenStore();
    expect(await store.isRevoked(hashToken('never-registered'))).toBe(false);
  });
});

describe('PgTokenStore(以 stub repository 验证语义)', () => {
  class FakeRepo {
    rows = new Map<string, AuthTokenEntity>();
    create(entity: Partial<AuthTokenEntity>) {
      return entity;
    }
    async save(entity: any) {
      const row = { id: `id-${this.rows.size + 1}`, createdAt: new Date(), ...entity } as AuthTokenEntity;
      this.rows.set(row.tokenHash, row);
      return row;
    }
    async update(where: any, patch: any) {
      const row = this.rows.get(where.tokenHash ?? '');
      if (row) Object.assign(row, patch);
    }
    async findOne({ where: { tokenHash } }: any) {
      return this.rows.get(tokenHash) ?? null;
    }
  }

  it('save 落摘要(不落明文),revoke 后 isRevoked=true', async () => {
    const repo = new FakeRepo();
    const store = new PgTokenStore(repo as any);
    const token = 'raw.jwt.token';
    await store.save({ tokenHash: hashToken(token), userId: 'u1', expiresAt: 123 });
    expect(await store.isRevoked(hashToken(token))).toBe(false);
    await store.revoke(hashToken(token));
    expect(await store.isRevoked(hashToken(token))).toBe(true);
    // 不落明文
    for (const row of repo.rows.values()) {
      expect(JSON.stringify(row)).not.toContain('raw.jwt.token');
    }
  });

  it('save 失败不抛出(令牌态写失败不阻断登录,JWT 签名校验兜底)', async () => {
    const failing = { save: async () => { throw new Error('db down'); } };
    const store = new PgTokenStore(failing as any);
    await expect(store.save({ tokenHash: 'h', userId: 'u', expiresAt: 1 })).resolves.toBeUndefined();
  });
});
