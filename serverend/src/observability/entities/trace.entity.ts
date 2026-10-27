/*
 * @Description: 一次 graph 执行(threadId)的轨迹头记录，落 PostgreSQL，不引入 Langfuse 等外部依赖
 */
import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const TRACE_TABLE = 'ai_trace';

export type TraceStatus = 'running' | 'ok' | 'suspended' | 'error';

@Entity(TRACE_TABLE)
export class TraceEntity {
  @PrimaryColumn({ name: 'thread_id', type: 'varchar', length: 64 })
  threadId: string;

  @Column({ name: 'session_id', type: 'varchar', length: 64, nullable: true })
  sessionId: string;

  @Column({ name: 'project_id', type: 'varchar', length: 64, nullable: true })
  projectId: string;

  /* 用户输入摘要(已截断)，便于回放定位 */
  @Column({ name: 'query_summary', type: 'text', nullable: true })
  querySummary: string;

  @Column({ name: 'canvas_node_count', type: 'int', default: 0 })
  canvasNodeCount: number;

  @Column({ name: 'intent', type: 'varchar', length: 32, nullable: true })
  intent: string;

  @Column({ name: 'intent_source', type: 'varchar', length: 16, nullable: true })
  intentSource: string;

  /* competitor-driven-evolution-batch Round 14:产物形态(flowchart/mindmap/table/checklist/timeline),
     形式路由后写入;旧行为 null。形态分布是本批次核心观测指标(区别于 intent 的一级路由) */
  @Column({ name: 'artifact_kind', type: 'varchar', length: 16, nullable: true })
  artifactKind: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'running' })
  status: TraceStatus;

  @Column({ name: 'result_kind', type: 'varchar', length: 32, nullable: true })
  resultKind: string;

  @Column({ name: 'total_duration_ms', type: 'int', default: 0 })
  totalDurationMs: number;

  @Column({ name: 'context_tokens', type: 'int', default: 0 })
  contextTokens: number;

  @Column({ name: 'rewrite_count', type: 'int', default: 0 })
  rewriteCount: number;

  @Column({ name: 'template_matched', type: 'boolean', default: false })
  templateMatched: boolean;

  /* 轨迹聚合指标(13.2)：由 trace.metrics 计算后整体写入，便于离线评估直接读取 */
  @Column({ name: 'metrics', type: 'jsonb', nullable: true })
  metrics: Record<string, any>;

  @Column({ name: 'token_usage', type: 'jsonb', nullable: true })
  tokenUsage: Record<string, any>;

  /* 异常信息(已脱敏，复用 error-sanitizer) */
  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary: string;

  @CreateDateColumn({ name: 'create_time', type: 'timestamp' })
  createTime?: Date;

  @UpdateDateColumn({ name: 'update_time', type: 'timestamp' })
  updateTime?: Date;
}
