/*
 * @Description: 轻量 trace 服务(13.1)
 * 按 threadId 记录一次 graph 执行的完整轨迹:步骤名、输入输出摘要(截断)、耗时、token 用量、异常(脱敏)。
 * 落 PostgreSQL(ai_trace / ai_trace_step)，不引入 Langfuse/Redis 等外部依赖。
 *
 * 设计约束:
 *   1. 埋点绝不能影响主链路 —— 所有方法内部 try/catch，失败只 Logger.warn；
 *   2. 注入方为 @Optional()，未装配 ObservabilityModule 时 graph 侧退化为 no-op；
 *   3. 单 thread 步骤数封顶(TRACE_MAX_STEPS_PER_THREAD)，避免无界增长；
 *   4. 轨迹按保留期清理(cleanupExpired)，由模块启动时的定时器触发。
 */
import { Injectable, Logger, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { TraceEntity, TraceStatus } from './entities/trace.entity';
import { TraceStepEntity, TraceStepStatus } from './entities/trace-step.entity';
import { computeTraceMetrics, CONTEXT_TOKEN_BUDGET } from './trace.metrics';
import {
  estimateUsage,
  normalizeUsage,
  summarize,
  summarizeError,
  TRACE_MAX_STEPS_PER_THREAD,
  TRACE_RETENTION_DAYS,
} from './trace.summarize';
import { TokenUsageLike, TraceMetrics, TraceStepRecord } from './trace.types';

/** 步骤埋点入参 */
export interface RecordStepInput {
  threadId: string;
  stepName: string;
  status?: TraceStepStatus;
  input?: unknown;
  output?: unknown;
  /** 步骤耗时(ms)，未传则由 startedAt 推算 */
  durationMs?: number;
  startedAt?: number;
  usage?: TokenUsageLike;
  /** usage 来源:actual = 模型返回；未传 usage 时按输出长度估算 */
  usageSource?: 'actual' | 'estimate' | 'none';
  errorType?: string;
  error?: unknown;
  meta?: Record<string, any>;
}

/** 轨迹查询响应 */
export interface TraceDetail {
  threadId: string;
  status: TraceStatus;
  intent?: string;
  intentSource?: string;
  resultKind?: string;
  templateMatched: boolean;
  querySummary?: string;
  canvasNodeCount: number;
  totalDurationMs: number;
  contextTokens: number;
  rewriteCount: number;
  tokenUsage?: TokenUsageLike;
  errorSummary?: string;
  metrics: TraceMetrics;
  steps: TraceStepRecord[];
  createTime?: Date;
  updateTime?: Date;
}

@Injectable()
export class TraceService {
  private readonly logger = new Logger(TraceService.name);
  /** 内存中的步骤序号计数，避免每步都查库取 max(seq) */
  private readonly seqCounters = new Map<string, number>();
  /** 超限标记:同一 thread 步骤数封顶后不再落库 */
  private readonly overflowThreads = new Set<string>();

  constructor(
    @Optional()
    @InjectRepository(TraceEntity)
    private readonly traceRepository?: Repository<TraceEntity>,
    @Optional()
    @InjectRepository(TraceStepEntity)
    private readonly stepRepository?: Repository<TraceStepEntity>,
  ) {}

  /** 是否可用(未注册实体仓库时埋点直接跳过) */
  get enabled(): boolean {
    return !!(this.traceRepository && this.stepRepository);
  }

  /** 轨迹开始:写入 header(status=running) */
  async startRun(input: {
    threadId: string;
    sessionId?: string;
    projectId?: string;
    query?: string;
    canvasNodeCount?: number;
  }): Promise<void> {
    if (!this.enabled || !input?.threadId) return;
    try {
      this.seqCounters.set(input.threadId, 0);
      this.overflowThreads.delete(input.threadId);
      await this.traceRepository!.save(
        this.traceRepository!.create({
          threadId: input.threadId,
          sessionId: input.sessionId ?? null,
          projectId: input.projectId ?? null,
          querySummary: summarize(input.query),
          canvasNodeCount: input.canvasNodeCount ?? 0,
          status: 'running' as TraceStatus,
          templateMatched: false,
          totalDurationMs: 0,
        }) as TraceEntity,
      );
    } catch (err) {
      this.logger.warn(`trace startRun 失败 threadId=${input.threadId}: ${err}`);
    }
  }

  /**
   * 记录一个步骤。返回记录到的 seq(失败返回 -1)，便于调用方串联。
   * 步骤数超过 TRACE_MAX_STEPS_PER_THREAD 时停止落库，防止无界增长。
   */
  async recordStep(input: RecordStepInput): Promise<number> {
    if (!this.enabled || !input?.threadId) return -1;
    const seq = (this.seqCounters.get(input.threadId) ?? 0) + 1;
    this.seqCounters.set(input.threadId, seq);
    if (seq > TRACE_MAX_STEPS_PER_THREAD) {
      this.overflowThreads.add(input.threadId);
      return -1;
    }

    try {
      const durationMs = resolveDuration(input);
      const usage = resolveUsage(input);
      await this.stepRepository!.save(
        this.stepRepository!.create({
          threadId: input.threadId,
          seq,
          stepName: String(input.stepName).slice(0, 64),
          status: input.status ?? 'ok',
          inputSummary: summarize(input.input),
          outputSummary: summarize(input.output),
          durationMs,
          promptTokens: usage.promptTokens,
          completionTokens: usage.completionTokens,
          totalTokens: usage.totalTokens,
          tokenSource: usage.source,
          errorType: input.errorType ?? undefined,
          errorSummary: input.error !== undefined ? summarizeError(input.error) : undefined,
          meta: input.meta ?? undefined,
        }) as TraceStepEntity,
      );
      return seq;
    } catch (err) {
      this.logger.warn(
        `trace recordStep 失败 threadId=${input.threadId} step=${input.stepName}: ${err}`,
      );
      return -1;
    }
  }

  /**
   * 便捷计时器:返回一个 finish 函数，用于包裹一段异步逻辑。
   * const step = trace.measure(threadId, TRACE_STEPS.TOOL_CALL, { input })
   * ... await step({ status: 'ok', output })
   */
  measure(
    threadId: string,
    stepName: string,
    preset: { input?: unknown; meta?: Record<string, any> } = {},
  ) {
    const startedAt = Date.now();
    return (
      extra: {
        status?: TraceStepStatus;
        output?: unknown;
        usage?: TokenUsageLike;
        usageSource?: 'actual' | 'estimate' | 'none';
        errorType?: string;
        error?: unknown;
        meta?: Record<string, any>;
      } = {},
    ) =>
      this.recordStep({
        threadId,
        stepName,
        startedAt,
        input: preset.input,
        meta: { ...(preset.meta ?? {}), ...(extra.meta ?? {}) },
        ...extra,
      });
  }

  /** 更新 header 的运行中字段(意图、上下文 token、改写次数、模板命中等) */
  async updateRun(
    threadId: string,
    patch: Partial<{
      intent: string;
      intentSource: string;
      resultKind: string;
      templateMatched: boolean;
      contextTokens: number;
      rewriteCount: number;
    }>,
  ): Promise<void> {
    if (!this.enabled || !threadId) return;
    try {
      await this.traceRepository!.update({ threadId }, patch as any);
    } catch (err) {
      this.logger.warn(`trace updateRun 失败 threadId=${threadId}: ${err}`);
    }
  }

  /** 轨迹结束:计算聚合指标并写入 header */
  async finishRun(input: {
    threadId: string;
    status: Exclude<TraceStatus, 'running'>;
    resultKind?: string;
    templateMatched?: boolean;
    totalDurationMs?: number;
    rewriteCount?: number;
    contextTokens?: number;
    error?: unknown;
  }): Promise<TraceMetrics | null> {
    if (!this.enabled || !input?.threadId) return null;
    try {
      const steps = await this.listStepRecords(input.threadId);
      const metrics = computeTraceMetrics({
        steps,
        status: input.status,
        resultKind: input.resultKind,
        templateMatched: input.templateMatched,
        totalDurationMs:
          input.totalDurationMs ??
          steps.reduce((acc, step) => acc + (step.durationMs || 0), 0),
        contextBudget: CONTEXT_TOKEN_BUDGET,
      });
      await this.traceRepository!.update(
        { threadId: input.threadId },
        {
          status: input.status,
          resultKind: input.resultKind ?? null,
          templateMatched: !!input.templateMatched,
          totalDurationMs: metrics.totalDurationMs,
          rewriteCount: input.rewriteCount ?? 0,
          contextTokens: input.contextTokens ?? metrics.contextTokens,
          metrics: metrics as any,
          tokenUsage: metrics.tokenUsage as any,
          errorSummary:
            input.error !== undefined ? summarizeError(input.error) : null,
        } as any,
      );
      this.seqCounters.delete(input.threadId);
      this.overflowThreads.delete(input.threadId);
      if (this.seqCounters.size > 1000) {
        /* 计数器兜底回收，避免长驻进程内 Map 无界增长(异常中断的 thread 不会走到 finishRun) */
        this.seqCounters.clear();
        this.overflowThreads.clear();
      }
      return metrics;
    } catch (err) {
      this.logger.warn(`trace finishRun 失败 threadId=${input.threadId}: ${err}`);
      return null;
    }
  }

  /** 查询完整轨迹(header + steps + 聚合指标) */
  async getTrace(threadId: string): Promise<TraceDetail | null> {
    if (!this.enabled || !threadId) return null;
    try {
      const header = await this.traceRepository!.findOne({ where: { threadId } });
      const steps = await this.listStepRecords(threadId);
      if (!header && !steps.length) return null;
      const metrics =
        (header?.metrics as TraceMetrics) ??
        computeTraceMetrics({
          steps,
          status: header?.status,
          resultKind: header?.resultKind,
          templateMatched: header?.templateMatched,
          totalDurationMs: header?.totalDurationMs,
          contextBudget: CONTEXT_TOKEN_BUDGET,
        });
      return {
        threadId,
        status: header?.status ?? 'running',
        intent: header?.intent,
        intentSource: header?.intentSource,
        resultKind: header?.resultKind,
        templateMatched: !!header?.templateMatched,
        querySummary: header?.querySummary,
        canvasNodeCount: header?.canvasNodeCount ?? 0,
        totalDurationMs: header?.totalDurationMs ?? metrics.totalDurationMs,
        contextTokens: header?.contextTokens ?? metrics.contextTokens,
        rewriteCount: header?.rewriteCount ?? 0,
        tokenUsage: header?.tokenUsage ?? metrics.tokenUsage,
        errorSummary: header?.errorSummary,
        metrics,
        steps,
        createTime: header?.createTime,
        updateTime: header?.updateTime,
      };
    } catch (err) {
      this.logger.warn(`trace getTrace 失败 threadId=${threadId}: ${err}`);
      return null;
    }
  }

  /** 最近轨迹列表(评估脚本/排障用) */
  async listRecent(limit = 20): Promise<TraceEntity[]> {
    if (!this.enabled) return [];
    try {
      return await this.traceRepository!.find({
        order: { updateTime: 'DESC' },
        take: Math.min(Math.max(limit, 1), 100),
      });
    } catch (err) {
      this.logger.warn(`trace listRecent 失败: ${err}`);
      return [];
    }
  }

  /** 清理过期轨迹(默认保留 14 天)，返回删除条数 */
  async cleanupExpired(days = TRACE_RETENTION_DAYS): Promise<{ traces: number; steps: number }> {
    if (!this.enabled) return { traces: 0, steps: 0 };
    try {
      const threshold = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const stepResult = await this.stepRepository!.delete({
        createTime: LessThan(threshold),
      });
      const traceResult = await this.traceRepository!.delete({
        createTime: LessThan(threshold),
      });
      return {
        traces: traceResult.affected ?? 0,
        steps: stepResult.affected ?? 0,
      };
    } catch (err) {
      this.logger.warn(`trace cleanupExpired 失败: ${err}`);
      return { traces: 0, steps: 0 };
    }
  }

  /** 读取步骤明细并归一化为 TraceStepRecord */
  private async listStepRecords(threadId: string): Promise<TraceStepRecord[]> {
    const rows = await this.stepRepository!.find({
      where: { threadId },
      order: { seq: 'ASC' },
    });
    return rows.map((row) => ({
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
  }
}

function resolveDuration(input: RecordStepInput): number {
  if (typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)) {
    return Math.max(0, Math.round(input.durationMs));
  }
  if (typeof input.startedAt === 'number' && Number.isFinite(input.startedAt)) {
    return Math.max(0, Date.now() - input.startedAt);
  }
  return 0;
}

/** token 用量:优先用调用方给的真实用量，其次按输出长度估算(并标注来源) */
function resolveUsage(
  input: RecordStepInput,
): Required<TokenUsageLike> & { source: string } {
  if (input.usageSource === 'none') {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'none' };
  }
  if (input.usage) {
    return { ...normalizeUsage(input.usage), source: input.usageSource ?? 'actual' };
  }
  if (input.output === undefined || input.output === null) {
    return { promptTokens: 0, completionTokens: 0, totalTokens: 0, source: 'none' };
  }
  return estimateUsage(input.output);
}
