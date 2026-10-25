// 语图技术方案 - 长期记忆 PG 表
// 文档(backend/storage.md):PG 一身多职(Store/画像/jsonb)。当前环境无 pgvector,
// 向量以 jsonb 存储,检索时按命名空间取有界候选集后在 JS 内计算余弦相似度。
// 命名空间隔离(security.md):project_id 用于跨项目记忆隔离,session_id 用于会话内召回。
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('ai_long_term_memories')
// NOTE:projectId/sessionId 的索引由下方字段级 @Index() 声明；
//       类级再声明一次会生成两个同名索引，TypeORM synchronize 时第二次 CREATE INDEX 报 42P07。
export class LongTermMemoryEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 255 })
  sessionId: string;

  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  projectId: string;

  @Column({ type: 'text' })
  content: string;

  @Column({ type: 'text', nullable: true })
  summary: string;

  @Column({ type: 'jsonb', nullable: true })
  keywords: string[];

  @Column({ type: 'jsonb', nullable: true })
  vector: number[];

  @Column({ type: 'float', default: 0.5 })
  importance: number;

  @Column({ type: 'int', default: 0 })
  accessCount: number;

  /** 最近访问时间(毫秒时间戳,与 MemoryRecord 对齐) */
  @Column({ type: 'bigint', default: 0 })
  lastAccessAt: number;

  @Column({ type: 'boolean', default: false })
  compressed: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  createdAtColumn: Date;

  /** 创建时间(毫秒时间戳) */
  @Column({ type: 'bigint', default: 0 })
  createdAt: number;
}
