// 语图技术方案 - 长期记忆(PostgresStore + pgvector 语义)
// 文档(memory.md):摘要 + 向量 + 关键词 + sessionEntitySlot + 元数据;
//   双路召回(关键词路 + 向量路) → RRF 融合取 top-10 → Reranker 取 top-3;
//   命名空间隔离:跨项目记忆按 project_id 隔离,读写均需校验(security.md 三维度数据隔离)。
// 约束:当前环境无 pgvector —— 向量以 jsonb 存储,取"有界候选集"后在 JS 内计算余弦相似度;
//   Embedding Provider 不可用时向量路自动退化,仅走关键词单路,并记录降级原因。
import { Injectable, Logger } from '@nestjs/common';
import { cosineSimilarity } from '../vector.util';
import { fuseRankedLists, RankedItem, RRF_FUSION_TOP_N, RERANK_TOP_N } from './rrf';

export interface MemoryRecord {
  id: string;
  sessionId: string;
  projectId?: string;
  content: string; // 记忆正文
  summary?: string; // 摘要
  keywords: string[]; // 关键词
  vector?: number[]; // 向量(维度取决于 embedding 模型)
  importance: number; // 重要度 0~1
  accessCount: number; // 访问次数
  lastAccessAt: number; // 最近访问
  createdAt: number;
  /** 遗忘扫描"再压缩"标记(Task 10.3) */
  compressed?: boolean;
}

export interface MemorySearchParams {
  sessionId?: string;
  projectId?: string;
  query: string;
  queryVector?: number[];
  topK?: number; // 默认 3
  entity?: string; // sessionEntitySlot 实体过滤
}

/** 有界候选集参数:双路召回前先从命名空间内取有限条记录 */
export interface CandidateParams {
  sessionId?: string;
  projectId?: string;
  entity?: string;
  limit?: number;
}

export interface LongTermStore {
  add(record: Omit<MemoryRecord, 'id' | 'accessCount' | 'lastAccessAt' | 'createdAt'>): Promise<string>;
  search(params: MemorySearchParams): Promise<MemoryRecord[]>;
  /** 取命名空间内的有界候选集(按最近访问倒序),供双路召回在 JS 内打分 */
  listCandidates(params: CandidateParams): Promise<MemoryRecord[]>;
  updateImportance(id: string, importance: number): Promise<void>;
  /** 局部更新(遗忘曲线"再压缩"回写摘要/标记) */
  updateRecord(id: string, patch: Partial<MemoryRecord>): Promise<void>;
  touch(id: string): Promise<void>;
  listForSession(sessionId: string): Promise<MemoryRecord[]>;
  delete(id: string): Promise<void>;
  listAll(): Promise<MemoryRecord[]>;
}

/** 双路召回的候选集上限(有界:防止全表进内存计算相似度) */
export const CANDIDATE_LIMIT = 200;

/** 命名空间校验:长期记忆必须限定在 session 或 project 之内,禁止全局检索 */
export function assertNamespace(params: { sessionId?: string; projectId?: string }, op: string): void {
  if (!params?.sessionId && !params?.projectId) {
    throw new Error(`长期记忆${op}缺少命名空间:必须提供 sessionId 或 projectId(禁止跨项目全局检索)`);
  }
}

/** 关键词路打分:记录关键词在查询中的命中数(实体命中加权) */
export function keywordScore(record: MemoryRecord, query: string, entity?: string): number {
  const q = (query ?? '').toLowerCase();
  let score = (record.keywords ?? []).reduce(
    (acc, kw) => (kw && q.includes(String(kw).toLowerCase()) ? acc + 1 : acc),
    0,
  );
  if (entity && record.keywords?.includes(entity)) score += 1;
  if (entity && q.includes(entity.toLowerCase())) score += 1;
  return score;
}

/** 向量路打分:余弦相似度(无向量时返回 -1,表示该路不适用) */
export function vectorScore(record: MemoryRecord, queryVector?: number[]): number {
  if (!queryVector || !record.vector) return -1;
  return cosineSimilarity(queryVector, record.vector);
}

/** 双路召回 + RRF 融合(纯函数,便于单测):返回融合后的有序 id 列表 */
export function fuseDualPath(
  candidates: MemoryRecord[],
  opts: { query: string; queryVector?: number[]; entity?: string; topN?: number },
): { ids: string[]; vectorPathEnabled: boolean } {
  const vectorPathEnabled = candidates.some((c) => Array.isArray(c.vector) && c.vector.length > 0) && !!opts.queryVector;

  const keywordList: RankedItem[] = candidates
    .map((c) => ({ id: c.id, score: keywordScore(c, opts.query, opts.entity) }))
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1));

  const vectorList: RankedItem[] = vectorPathEnabled
    ? candidates
        .map((c) => ({ id: c.id, score: vectorScore(c, opts.queryVector) }))
        .filter((item) => item.score >= 0)
        .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
    : [];

  const lists = [keywordList, vectorList].filter((l) => l.length > 0);
  // 两路都无信号时,退化为"最近访问优先",避免召回为空
  if (lists.length === 0) {
    const fallback = [...candidates]
      .sort((a, b) => b.lastAccessAt - a.lastAccessAt)
      .slice(0, opts.topN ?? RRF_FUSION_TOP_N)
      .map((c) => c.id);
    return { ids: fallback, vectorPathEnabled: false };
  }

  return {
    ids: fuseRankedLists(lists, { topN: opts.topN ?? RRF_FUSION_TOP_N }).map((e) => e.id),
    vectorPathEnabled,
  };
}

// ---------- 内存实现(兜底/本地开发) ----------
export class InMemoryLongTermStore implements LongTermStore {
  private records = new Map<string, MemoryRecord>();
  private seq = 0;

  async add(record) {
    const id = `mem_${++this.seq}_${Date.now()}`;
    this.records.set(id, {
      ...record,
      id,
      accessCount: 0,
      lastAccessAt: Date.now(),
      createdAt: Date.now(),
    });
    return id;
  }

  async search(params: MemorySearchParams) {
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
      topN: Math.max(topK, RRF_FUSION_TOP_N),
    });
    const picked = ids
      .map((id) => this.records.get(id))
      .filter(Boolean)
      .slice(0, topK) as MemoryRecord[];
    for (const r of picked) {
      r.accessCount += 1;
      r.lastAccessAt = Date.now();
    }
    return picked;
  }

  async listCandidates(params: CandidateParams): Promise<MemoryRecord[]> {
    let list = [...this.records.values()];
    if (params.sessionId) list = list.filter((r) => r.sessionId === params.sessionId);
    if (params.projectId) list = list.filter((r) => r.projectId === params.projectId);
    if (params.entity) list = list.filter((r) => r.keywords?.includes(params.entity!));
    return list
      .sort((a, b) => b.lastAccessAt - a.lastAccessAt)
      .slice(0, params.limit ?? CANDIDATE_LIMIT);
  }

  async updateImportance(id: string, importance: number) {
    const r = this.records.get(id);
    if (r) r.importance = importance;
  }

  async updateRecord(id: string, patch: Partial<MemoryRecord>) {
    const r = this.records.get(id);
    if (r) this.records.set(id, { ...r, ...patch, id });
  }

  async touch(id: string) {
    const r = this.records.get(id);
    if (r) {
      r.accessCount += 1;
      r.lastAccessAt = Date.now();
    }
  }

  async listForSession(sessionId: string) {
    if (!sessionId) return [];
    return [...this.records.values()].filter((r) => r.sessionId === sessionId);
  }

  async delete(id: string) {
    this.records.delete(id);
  }

  async listAll() {
    return [...this.records.values()];
  }
}

/** 重排器:把 RRF top-10 交给模型 listwise 重排,取 top-3;不可用时返回 null(退化 RRF 序) */
export interface MemoryReranker {
  rerank(query: string, candidates: MemoryRecord[]): Promise<string[] | null>;
  unavailableReason(): string | null;
}

export interface MemorySearchResult {
  records: MemoryRecord[];
  /** 降级信息:向量路不可用 / 重排不可用时记录原因(日志 + trace 字段) */
  degraded?: Array<{ stage: 'embedding' | 'rerank'; reason: string }>;
}

// ---------- 长期记忆服务 ----------
@Injectable()
export class LongTermMemoryService {
  private readonly logger = new Logger(LongTermMemoryService.name);
  private store: LongTermStore = new InMemoryLongTermStore();
  private reranker: MemoryReranker | null = null;
  private embedder: { embedQuery(text: string): Promise<number[] | null>; unavailableReason(): string | null } | null =
    null;

  setStore(store: LongTermStore) {
    this.store = store;
  }

  /** 注入 embedding provider(可选):注入后自动补齐向量路 */
  setEmbedder(embedder: LongTermMemoryService['embedder']) {
    this.embedder = embedder;
  }

  /** 注入重排器(可选):不注入或不可用时退化为 RRF 序 */
  setReranker(reranker: MemoryReranker | null) {
    this.reranker = reranker;
  }

  /** 写入:命名空间强制校验(禁止无归属的游离记忆) */
  async add(record: Omit<MemoryRecord, 'id' | 'accessCount' | 'lastAccessAt' | 'createdAt'>) {
    assertNamespace(record, '写入');
    if (!record.content?.trim()) {
      this.logger.warn('长期记忆写入被跳过:内容为空');
      return '';
    }

    let vector = record.vector;
    if (!vector && this.embedder) {
      vector = (await this.embedder.embedQuery(record.summary || record.content)) ?? undefined;
      if (!vector) {
        this.logger.warn(`长期记忆向量缺失,退化为关键词单路: ${this.embedder.unavailableReason() ?? '未知原因'}`);
      }
    }

    return this.store.add({ ...record, vector });
  }

  /** 检索:双路召回 → RRF top-10 → Reranker top-3;任一环节不可用即降级并记录原因 */
  async search(params: MemorySearchParams): Promise<MemoryRecord[]> {
    const result = await this.searchWithMeta(params);
    return result.records;
  }

  /** 检索(带降级信息):供上下文组装写入 trace 字段 */
  async searchWithMeta(params: MemorySearchParams): Promise<MemorySearchResult> {
    const degraded: MemorySearchResult['degraded'] = [];
    assertNamespace(params, '检索');

    let queryVector = params.queryVector;
    if (!queryVector && this.embedder) {
      queryVector = (await this.embedder.embedQuery(params.query)) ?? undefined;
      if (!queryVector) {
        degraded.push({
          stage: 'embedding',
          reason: this.embedder.unavailableReason() ?? 'embedding 不可用,向量路降级',
        });
      }
    } else if (!queryVector) {
      degraded.push({ stage: 'embedding', reason: '未配置 embedding provider,向量路降级' });
    }

    const topK = params.topK ?? RERANK_TOP_N;
    const candidates = await this.store.listCandidates({
      sessionId: params.sessionId,
      projectId: params.projectId,
      entity: params.entity,
      limit: CANDIDATE_LIMIT,
    });
    if (candidates.length === 0) return { records: [], degraded };

    const { ids, vectorPathEnabled } = fuseDualPath(candidates, {
      query: params.query,
      queryVector,
      entity: params.entity,
      topN: RRF_FUSION_TOP_N,
    });
    if (!vectorPathEnabled && !degraded.some((d) => d.stage === 'embedding')) {
      degraded.push({ stage: 'embedding', reason: '候选记忆均无向量,向量路降级' });
    }

    const fused = ids.map((id) => candidates.find((c) => c.id === id)).filter(Boolean) as MemoryRecord[];

    // Reranker:取 top-3;不可用/失败时退化为 RRF 序
    let ordered = fused;
    if (this.reranker && fused.length > 1) {
      const rerankedIds = await this.safeRerank(params.query, fused, degraded);
      if (rerankedIds) {
        ordered = rerankedIds.map((id) => fused.find((r) => r.id === id)).filter(Boolean) as MemoryRecord[];
      }
    }

    const picked = ordered.slice(0, topK);
    for (const r of picked) {
      await this.store.touch(r.id);
    }
    if (degraded.length > 0) {
      this.logger.warn(
        `长期记忆检索降级: session=${params.sessionId ?? '-'}, project=${params.projectId ?? '-'}, ${degraded
          .map((d) => `${d.stage}(${d.reason})`)
          .join('; ')}`,
      );
    }
    return { records: picked, degraded: degraded.length ? degraded : undefined };
  }

  private async safeRerank(
    query: string,
    candidates: MemoryRecord[],
    degraded: NonNullable<MemorySearchResult['degraded']>,
  ): Promise<string[] | null> {
    if (!this.reranker) return null;
    try {
      const ids = await this.reranker.rerank(query, candidates);
      if (!ids || ids.length === 0) {
        degraded.push({ stage: 'rerank', reason: this.reranker.unavailableReason() ?? '重排返回空,退化 RRF 序' });
        return null;
      }
      return ids;
    } catch (err) {
      degraded.push({ stage: 'rerank', reason: `重排失败: ${(err as Error)?.message ?? 'unknown'}` });
      return null;
    }
  }

  async touch(id: string) {
    return this.store.touch(id);
  }

  async updateImportance(id: string, importance: number) {
    return this.store.updateImportance(id, importance);
  }

  async updateRecord(id: string, patch: Partial<MemoryRecord>) {
    return this.store.updateRecord(id, patch);
  }

  async listForSession(sessionId: string) {
    if (!sessionId) return [];
    return this.store.listForSession(sessionId);
  }

  /** 按命名空间列出(遗忘扫描/排障用);projectId 必填以避免跨项目读取 */
  async listByProject(projectId: string) {
    if (!projectId) return [];
    return this.store.listCandidates({ projectId, limit: Number.MAX_SAFE_INTEGER });
  }

  async listAll() {
    return this.store.listAll();
  }

  /** 供遗忘曲线定时器使用:底层 store 引用 */
  getStore(): LongTermStore {
    return this.store;
  }
}
