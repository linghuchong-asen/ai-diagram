// 语图技术方案 - 登录令牌态表(Task 11.3)
// 文档(backend/auth.md):登录签发 JWT 的同时写入令牌态,支持登出主动失效/吊销。
// 安全(security.md):服务端只存 token 摘要(sha256),不落明文令牌。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('auth_tokens')
// NOTE:userId 的索引由下方字段级 @Index() 声明；类级重复声明会生成同名索引导致 synchronize 42P07。
export class AuthTokenEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 令牌摘要(sha256),不存明文 JWT */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'token_hash' })
  tokenHash: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId: string;

  /** 过期时间(毫秒时间戳,与 JWT exp 对齐) */
  @Column({ type: 'bigint' })
  expiresAt: number;

  /** 吊销时间(登出/主动失效);null = 有效 */
  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @CreateDateColumn({ type: 'timestamp' })
  createdAt: Date;
}
