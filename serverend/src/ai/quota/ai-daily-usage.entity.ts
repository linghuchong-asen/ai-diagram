// 语图技术方案 - 用户级每日 AI 用量表(Task 11.5 Token 三级防护·用户级)
// 文档(security.md Token 成本防护):每用户每日配额上限,按「生成/修改」分开计量,
//       token 数单独累计(按 token 计量才能真实反映成本)。
import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
  Unique,
} from 'typeorm';

@Entity('ai_daily_usage')
@Unique('uq_ai_daily_usage_user_day', ['userId', 'day'])
export class AiDailyUsageEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId: string;

  /** 统计日(UTC+8 的 YYYY-MM-DD) */
  @Column({ type: 'varchar', length: 10 })
  day: string;

  /** 当日 generate 次数 */
  @Column({ type: 'int', name: 'generate_count', default: 0 })
  generateCount: number;

  /** 当日 modify 次数 */
  @Column({ type: 'int', name: 'modify_count', default: 0 })
  modifyCount: number;

  /** 当日累计 token(估算) */
  @Column({ type: 'int', default: 0 })
  tokens: number;

  /** Task 2 分享获赠:首次成功分享 +1,日奖励上限 3(LEAST 封顶) */
  @Column({ type: 'int', name: 'bonus_generate', default: 0 })
  bonusGenerate: number;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updatedAt: Date;
}
