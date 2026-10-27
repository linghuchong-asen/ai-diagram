// 语图留存与裂变加强批次 - 邀请里程碑领取记录实体
// (userId, milestone) 唯一：每档奖励每人仅一次。跨档自动发放时以
// INSERT ON CONFLICT DO NOTHING RETURNING 抢占，天然防并发重复发放。
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('invite_milestone')
@Unique('uq_invite_milestone_user_milestone', ['userId', 'milestone'])
export class InviteMilestoneEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 邀请人 */
  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId: string;

  /** 里程碑档位（累计邀请人数阈值，对应 INVITE_MILESTONES.count） */
  @Column({ type: 'int' })
  milestone: number;

  /** 本档加送会员天数（落库留痕便于对账） */
  @Column({ type: 'int', name: 'reward_days' })
  rewardDays: number;

  @CreateDateColumn({ type: 'timestamp', name: 'create_time' })
  createTime?: Date;
}
