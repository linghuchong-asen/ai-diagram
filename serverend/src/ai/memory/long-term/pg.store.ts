// 语图技术方案 - 长期记忆的 PG 实现(无 pgvector 环境)
// 存储:ai_long_term_memories(向量与关键词走 jsonb)。
// 检索:按命名空间(session/project)取有界候选集(默认 200 条,按最近访问倒序),
//       在 JS 内完成关键词路 + 向量路打分与 RRF 融合(见 long-term.store.ts fuseDualPath)。
// 隔离:所有查询都强制带 sessionId 或 projectId 条件,禁止全局扫描式召回。
import { Logger } from '@nestjs/common';
import { Repository } from 'typeorm';
import {
  CANDIDATE_LIMIT,
  CandidateParams,
  fuseDualPath,
  LongTermStore,
  MemoryRecord,
  MemorySearchParams,
} from './long-term.store';
import { LongTermMemoryEntity } from './long-term.entity';
import { RERANK_TOP_N } from './rrf';

export class PgLongTermStore implements LongTermStore {
  private readonly logger = new Logger(PgLongTermStore.name);

  constructor(private readonly repo: Repository<LongTermMemoryEntity>) {}

  async add(record: Omit<MemoryRecord, 'id' | 'accessCount' | 'lastAccessAt' | 'createdAt'>): Promise<string> {
    const now = Date.now();
    const row = await this.repo.save(
      this.repo.create({
        sessionId: record.sessionId,
        projectId: record.projectId ?? null,
        content: record.content,
        summary: record.summary ?? null,
        keywords: record.keywords ?? [],
        vector: record.vector ?? null,
        importance: record.importance ?? 0.5,
        accessCount: 0,
        lastAccessAt: now,
        createdAt: now,
      } as Partial<LongTermMemoryEntity>) as LongTermMemoryEntity,
    );
    return row.id;
  }

  async search(params: MemorySearchParams): Promise<MemoryRecord[]> {
    const topK = params.topK ?? RERANK_TOP_N;
    const candidates = await this.listCandidates({
      sessionId: params.sessionId,
      projectId: params.projectId,
      entity: params.entity,
      limit: CANDIDATE_LIMIT,
    });
    const { ids } = fuseDualPath(candidates, {
      query: params.query,
      queryVector: params.queryVector,
      entity: params.entity,
      topN: Math.max(topK, 10),
    });
    const picked = ids
      .map((id) => candidates.find((c) => c.id === id))
      .filter(Boolean)
      .slice(0, topK) as MemoryRecord[];
    for (const r of picked) await this.touch(r.id);
    return picked;
  }

  async listCandidates(params: CandidateParams): Promise<MemoryRecord[]> {
    const qb = this.repo.createQueryBuilder('m');
    if (params.sessionId) qb.andWhere('m.sessionId = :sessionId', { sessionId: params.sessionId });
    if (params.projectId) qb.andWhere('m.projectId = :projectId', { projectId: params.projectId });
    if (!params.sessionId && !params.projectId) {
      // 命名空间隔离:拒绝无条件全表召回
      throw new Error('长期记忆候选集查询缺少命名空间(sessionId / projectId)');
    }
    qb.orderBy('m.lastAccessAt', 'DESC').take(params.limit ?? CANDIDATE_LIMIT);
    const rows = await qb.getMany();
    return rows.map((r) => this.toRecord(r));
  }

  async updateImportance(id: string, importance: number): Promise<void> {
    await this.repo.update({ id }, { importance });
  }

  async updateRecord(id: string, patch: Partial<MemoryRecord>): Promise<void> {
    const data: Partial<LongTermMemoryEntity> = {};
    if (patch.summary !== undefined) data.summary = patch.summary;
    if (patch.content !== undefined) data.content = patch.content;
    if (patch.keywords !== undefined) data.keywords = patch.keywords;
    if (patch.vector !== undefined) data.vector = patch.vector;
    if (patch.importance !== undefined) data.importance = patch.importance;
    if (patch.compressed !== undefined) data.compressed = patch.compressed;
    await this.repo.update({ id }, data);
  }

  async touch(id: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return;
    row.accessCount = (Number(row.accessCount) || 0) + 1;
    row.lastAccessAt = Date.now();
    await this.repo.save(row);
  }

  async listForSession(sessionId: string): Promise<MemoryRecord[]> {
    if (!sessionId) return [];
    const rows = await this.repo.find({ where: { sessionId }, order: { lastAccessAt: 'DESC' }, take: CANDIDATE_LIMIT });
    return rows.map((r) => this.toRecord(r));
  }

  async delete(id: string): Promise<void> {
    await this.repo.delete({ id });
  }

  /** 遗忘曲线扫描用:分页遍历全表(仅由后台定时器调用,不对外暴露检索语义) */
  async listAll(): Promise<MemoryRecord[]> {
    const rows = await this.repo.find();
    return rows.map((r) => this.toRecord(r));
  }

  private toRecord(row: LongTermMemoryEntity): MemoryRecord {
    return {
      id: row.id,
      sessionId: row.sessionId,
      projectId: row.projectId ?? undefined,
      content: row.content,
      summary: row.summary ?? undefined,
      keywords: row.keywords ?? [],
      vector: row.vector ?? undefined,
      importance: Number(row.importance) || 0,
      accessCount: Number(row.accessCount) || 0,
      // pg bigint 列驱动返回字符串,统一转数字
      lastAccessAt: Number(row.lastAccessAt) || 0,
      createdAt: Number(row.createdAt) || 0,
      compressed: !!row.compressed,
    };
  }
}
