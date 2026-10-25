// 语图技术方案 - 记忆体系装配器(Task 10 收尾)
// 职责:模块启动时把「PG 存储 / Embedding Provider / Reranker」接线到既有记忆服务:
//   - CHECKPOINT_STORE=memory|pg(默认 memory):短期记忆 Checkpointer 后端切换(Task 10.1);
//   - LONG_TERM_STORE=memory|pg(默认 pg):长期记忆存储切换,无 pgvector,向量走 jsonb + JS 余弦(Task 10.2);
//   - EMBEDDING_PROVIDER:注入 LongTermMemoryService(向量路)与 graph(话题切换),不可用自动退化单路;
//   - Reranker:LLM 可用时启用中模型 listwise 重排,否则退化 RRF 序(Task 10.2)。
// 说明:不在此处注入依赖缺失即抛错——所有能力都有内存/降级路径,保证 AI 主链路可用。
import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { Repository } from 'typeorm';
import { CheckpointService } from './short-term/checkpoint.memory';
import { PgCheckpointSaver } from './short-term/checkpoint.pg.saver';
import { LongTermMemoryService } from './long-term/long-term.store';
import { PgLongTermStore } from './long-term/pg.store';
import { LongTermMemoryEntity } from './long-term/long-term.entity';
import { AiCheckpointEntity } from './short-term/checkpoint.entity';
import { LlmMemoryReranker } from './long-term/reranker';
import { EmbeddingProvider, EmbeddingProviderFactory, EMBEDDING_PROVIDER } from './embedding.provider';
import { LlmFactory } from '../adapters/llm.factory';

@Injectable()
export class MemoryStoreWiringService implements OnModuleInit {
  private readonly logger = new Logger(MemoryStoreWiringService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly checkpoints: CheckpointService,
    private readonly longTermMemory: LongTermMemoryService,
    private readonly llmFactory: LlmFactory,
    private readonly reranker: LlmMemoryReranker,
    private readonly embeddingFactory: EmbeddingProviderFactory,
    @InjectRepository(AiCheckpointEntity)
    private readonly checkpointRepo: Repository<AiCheckpointEntity>,
    @InjectRepository(LongTermMemoryEntity)
    private readonly longTermRepo: Repository<LongTermMemoryEntity>,
    @Optional() @Inject(EMBEDDING_PROVIDER) private readonly embedder?: EmbeddingProvider,
  ) {}

  onModuleInit(): void {
    // ---- 短期记忆:Checkpointer 后端(Task 10.1,默认内存,可切 PG) ----
    const saverKind = (this.config.get('CHECKPOINT_STORE') || 'memory').toLowerCase();
    if (saverKind === 'pg') {
      this.checkpoints.setSaver(new PgCheckpointSaver(this.checkpointRepo));
    }

    // ---- 长期记忆:存储后端(Task 10.2,默认 PG 单库) ----
    const storeKind = (this.config.get('LONG_TERM_STORE') || 'pg').toLowerCase();
    if (storeKind === 'pg') {
      this.longTermMemory.setStore(new PgLongTermStore(this.longTermRepo));
    }

    // ---- Embedding Provider(向量路;不可用时长期记忆自动退化关键词单路) ----
    if (this.embedder) {
      this.longTermMemory.setEmbedder({
        embedQuery: (text: string) => this.embedder!.embedQuery(text),
        unavailableReason: () => this.embedder!.unavailableReason(),
      });
    }

    // ---- Reranker(Task 10.2:LLM 可用时启用,否则退化 RRF 序) ----
    if (this.llmFactory.isAvailable()) {
      this.longTermMemory.setReranker(this.reranker);
    } else {
      this.longTermMemory.setReranker(null);
      this.logger.warn(
        `Reranker 未启用(LLM 不可用): ${this.llmFactory.getUnavailableReason() ?? '未知原因'} → 记忆重排退化为 RRF 序`,
      );
    }

    this.logger.log(
      `记忆体系装配完成: checkpoint=${this.checkpoints.getSaverName()}, longTermStore=${
        storeKind === 'pg' ? 'PgLongTermStore' : 'InMemoryLongTermStore'
      }, embedding=${this.embedder?.name ?? 'null'}(${
        this.embedder?.available() ? 'available' : 'unavailable'
      }), reranker=${this.llmFactory.isAvailable() ? 'LlmMemoryReranker' : 'off'}`,
    );
  }
}
