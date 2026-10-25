// 语图技术方案 - 短期记忆 Checkpointer 的 PG 持久化表
// 文档(backend/storage.md):PG 一身多职,短期记忆 Checkpointer 可落 PG 表。
// 结构:thread_id 主键 + state jsonb + updated_at(整状态快照存 jsonb,读写各一次)。
import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from 'typeorm';
import { CheckpointState } from './checkpoint.memory';

@Entity('ai_checkpoints')
export class AiCheckpointEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  threadId: string;

  @Column({ type: 'jsonb', nullable: true })
  state: CheckpointState;

  @Index()
  @UpdateDateColumn({ type: 'timestamp' })
  updatedAt: Date;
}
