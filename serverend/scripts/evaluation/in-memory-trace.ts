/*
 * @Description: 评估脚本用的内存版 trace 仓库(Task 13.3)
 *
 * 不引入任何新基础设施:仅用 Map 实现 TypeORM Repository 的最小子集，
 * 交给真实 TraceService 使用 —— 这样 seq 计数、步骤封顶、指标聚合、摘要截断
 * 等生产逻辑在评估中被完整执行(而不是被 mock 掉)。
 */
import { Repository } from 'typeorm';
import { TraceService } from '../../src/observability/trace.service';
import { TraceEntity } from '../../src/observability/entities/trace.entity';
import { TraceStepEntity } from '../../src/observability/entities/trace-step.entity';
import { TraceStepRecord } from '../../src/observability/trace.types';

type Row = Record<string, any>;

/** 匹配 TypeORM FindOperator 的最小子集(仅评估脚本用到的 lessThan / 等值) */
function matches(row: Row, where?: Row): boolean {
  if (!where) return true;
  return Object.keys(where).every((key) => {
    const expected = where[key];
    const actual = row[key];
    if (expected && typeof expected === 'object' && expected._type) {
      if (expected._type === 'lessThan') return toTime(actual) < toTime(expected._value);
      if (expected._type === 'moreThan') return toTime(actual) > toTime(expected._value);
      return false;
    }
    return actual === expected;
  });
}

function toTime(value: unknown): number {
  const t = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(t) ? t : 0;
}

/** 内存 Repository:create/save/update/findOne/find/delete */
export class InMemoryRepository<T extends Row> {
  private readonly rows: T[] = [];
  private seq = 0;

  constructor(private readonly keyOf: (row: T) => string | number) {}

  create(plain: Partial<T>): T {
    return { ...plain } as T;
  }

  async save(entity: T | T[]): Promise<T | T[]> {
    const list = Array.isArray(entity) ? entity : [entity];
    for (const item of list) {
      const row = item as Row;
      const key = this.keyOf(item);
      const idx = this.rows.findIndex((r) => this.keyOf(r) === key);
      const now = new Date();
      if (idx >= 0) {
        this.rows[idx] = { ...this.rows[idx], ...row, updateTime: now } as T;
      } else {
        row.id = row.id ?? ++this.seq;
        row.createTime = row.createTime ?? now;
        row.updateTime = now;
        this.rows.push(row as T);
      }
    }
    return entity;
  }

  async update(criteria: Row, patch: Row): Promise<{ affected: number }> {
    let affected = 0;
    for (let i = 0; i < this.rows.length; i++) {
      if (matches(this.rows[i] as Row, criteria)) {
        this.rows[i] = { ...this.rows[i], ...patch, updateTime: new Date() } as T;
        affected++;
      }
    }
    return { affected };
  }

  async findOne(options: { where?: Row } = {}): Promise<T | null> {
    return this.rows.find((row) => matches(row as Row, options.where)) ?? null;
  }

  async find(options: { where?: Row; order?: Row; take?: number } = {}): Promise<T[]> {
    let result = this.rows.filter((row) => matches(row as Row, options.where));
    const orderKey = options.order ? Object.keys(options.order)[0] : undefined;
    if (orderKey) {
      const dir = String(options.order![orderKey]).toUpperCase() === 'DESC' ? -1 : 1;
      result = result.slice().sort((a, b) => {
        const av = (a as Row)[orderKey];
        const bv = (b as Row)[orderKey];
        const at = av instanceof Date ? av.getTime() : Number(av) || 0;
        const bt = bv instanceof Date ? bv.getTime() : Number(bv) || 0;
        return (at - bt) * dir;
      });
    }
    if (typeof options.take === 'number') result = result.slice(0, options.take);
    return result;
  }

  async delete(criteria: Row): Promise<{ affected: number }> {
    const kept: T[] = [];
    let affected = 0;
    for (const row of this.rows) {
      if (matches(row as Row, criteria)) affected++;
      else kept.push(row);
    }
    this.rows.length = 0;
    this.rows.push(...kept);
    return { affected };
  }

  /** 评估断言用:直接拿全部行 */
  all(): T[] {
    return this.rows.slice();
  }
}

export interface InMemoryTrace {
  service: TraceService;
  traceRepo: InMemoryRepository<TraceEntity & Row>;
  stepRepo: InMemoryRepository<TraceStepEntity & Row>;
  /** 某 thread 的全部步骤(已按 seq 升序，可直接喂给 computeTraceMetrics) */
  stepsOf(threadId: string): TraceStepRecord[];
  /** 某 thread 的 header 行(含 metrics) */
  headerOf(threadId: string): (TraceEntity & Row) | null;
}

/** 组装一个不落库、但走完整 TraceService 逻辑的观测实例 */
export function createInMemoryTrace(): InMemoryTrace {
  const traceRepo = new InMemoryRepository<TraceEntity & Row>((row) => row.threadId);
  const stepRepo = new InMemoryRepository<TraceStepEntity & Row>(
    (row) => `${row.threadId}#${row.seq}`,
  );
  const service = new TraceService(
    traceRepo as unknown as Repository<TraceEntity>,
    stepRepo as unknown as Repository<TraceStepEntity>,
  );

  return {
    service,
    traceRepo,
    stepRepo,
    stepsOf(threadId: string): TraceStepRecord[] {
      return stepRepo
        .all()
        .filter((row) => row.threadId === threadId)
        .sort((a, b) => a.seq - b.seq)
        .map((row) => ({
          seq: row.seq,
          stepName: row.stepName,
          status: row.status,
          inputSummary: row.inputSummary,
          outputSummary: row.outputSummary,
          durationMs: row.durationMs ?? 0,
          usage: {
            promptTokens: row.promptTokens ?? 0,
            completionTokens: row.completionTokens ?? 0,
            totalTokens: row.totalTokens ?? 0,
            source: (row.tokenSource as 'actual' | 'estimate') ?? undefined,
          },
          errorType: row.errorType,
          errorSummary: row.errorSummary,
          meta: row.meta,
          createTime: row.createTime,
        }));
    },
    headerOf(threadId: string) {
      return traceRepo.all().find((row) => row.threadId === threadId) ?? null;
    },
  };
}
