// 语图投稿激励批次 - 社区模板复制里程碑领取记录实体
// (userId, milestone) 唯一：每档每人仅一次。跨档自动发放时以
// INSERT ON CONFLICT DO NOTHING RETURNING 抢占，天然防并发重复发放。
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('template_copy_reward')
@Unique('uq_template_copy_reward_user_milestone', ['userId', 'milestone'])
export class TemplateCopyRewardEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 投稿人（社区模板 owner_id） */
  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId: string;

  /** 里程碑档位（累计被复制次数阈值，对应 COMMUNITY_COPY_MILESTONES.count） */
  @Column({ type: 'int' })
  milestone: number;

  /** 本档加送会员天数（落库留痕便于对账） */
  @Column({ type: 'int', name: 'reward_days' })
  rewardDays: number;

  @CreateDateColumn({ type: 'timestamp', name: 'create_time' })
  createTime?: Date;
}
