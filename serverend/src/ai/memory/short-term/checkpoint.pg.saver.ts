// 语图技术方案 - 短期记忆 Checkpointer 的 PG 实现(与内存实现可切换)
// 文档:短期记忆 = Checkpointer 每轮落 State;生产建议落库(backend/storage.md:PG 一身多职)。
// 切换方式:环境变量 CHECKPOINT_STORE=memory|pg(默认 memory),由 AiModule 装配时决定。
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AiCheckpointEntity } from './checkpoint.entity';
import { CheckpointSaver, CheckpointState } from './checkpoint.memory';

export class PgCheckpointSaver implements CheckpointSaver {
  private readonly logger = new Logger(PgCheckpointSaver.name);

  constructor(private readonly repo: Repository<AiCheckpointEntity>) {}

  async get(threadId: string): Promise<CheckpointState | null> {
    const row = await this.repo.findOne({ where: { threadId } });
    if (!row?.state) return null;
    return row.state as CheckpointState;
  }

  async put(state: CheckpointState): Promise<void> {
    await this.repo.save({
      threadId: state.threadId,
      state,
    } as AiCheckpointEntity);
  }

  async delete(threadId: string): Promise<void> {
    await this.repo.delete({ threadId });
  }

  async list(limit = 20): Promise<CheckpointState[]> {
    const rows = await this.repo.find({ order: { updatedAt: 'DESC' }, take: limit });
    return rows.map((r) => r.state).filter(Boolean) as CheckpointState[];
  }
}
