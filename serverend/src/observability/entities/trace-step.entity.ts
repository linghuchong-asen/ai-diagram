/*
 * @Description: 轨迹步骤明细(意图识别/上下文组装/工具调用/生成/反思…)，按 threadId 聚合查询
 */
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export const TRACE_STEP_TABLE = 'ai_trace_step';

export type TraceStepStatus = 'ok' | 'fail' | 'skipped';

@Entity(TRACE_STEP_TABLE)
@Index('idx_trace_step_thread', ['threadId', 'seq'])
export class TraceStepEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_trace_step_thread_id')
  @Column({ name: 'thread_id', type: 'varchar', length: 64 })
  threadId: string;

  /* 步骤在轨迹内的顺序号，从 1 递增 */
  @Column({ name: 'seq', type: 'int', default: 0 })
  seq: number;

  /* 步骤名，取值见 TRACE_STEPS(如 intent.recognize / tool.call / reflection.evaluate) */
  @Column({ name: 'step_name', type: 'varchar', length: 64 })
  stepName: string;

  @Column({ name: 'status', type: 'varchar', length: 16, default: 'ok' })
  status: TraceStepStatus;

  /* 输入/输出摘要(已截断，异常内容经 error-sanitizer 脱敏) */
  @Column({ name: 'input_summary', type: 'text', nullable: true })
  inputSummary: string;

  @Column({ name: 'output_summary', type: 'text', nullable: true })
  outputSummary: string;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs: number;

  @Column({ name: 'prompt_tokens', type: 'int', default: 0 })
  promptTokens: number;

  @Column({ name: 'completion_tokens', type: 'int', default: 0 })
  completionTokens: number;

  @Column({ name: 'total_tokens', type: 'int', default: 0 })
  totalTokens: number;

  /* token 来源：actual = 模型返回；estimate = 按字符估算 */
  @Column({ name: 'token_source', type: 'varchar', length: 16, nullable: true })
  tokenSource: string;

  @Column({ name: 'error_type', type: 'varchar', length: 32, nullable: true })
  errorType: string;

  @Column({ name: 'error_summary', type: 'text', nullable: true })
  errorSummary: string;

  /* 步骤附加信息(意图置信度、工具名、反思 issue 列表等) */
  @Column({ name: 'meta', type: 'jsonb', nullable: true })
  meta: Record<string, any>;

  @CreateDateColumn({ name: 'create_time', type: 'timestamp' })
  createTime?: Date;
}
