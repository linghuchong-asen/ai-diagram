// 语图留存与裂变加强批次 - 每日签到记录实体
// 设计要点：
//   - (userId, day) 唯一约束保证「每日一次签到」由数据库兜底（幂等最后一道闸）；
//   - streak 记录签到当日的连续天数（昨日有签则 +1，否则重置 1），
//     连签 7 天的整数倍由服务层触发会员天数奖励（checkin_vip 事件）。
import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('daily_checkin')
@Unique('uq_daily_checkin_user_day', ['userId', 'day'])
export class DailyCheckinEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 签到用户 */
  @Column({ type: 'varchar', length: 64, name: 'user_id' })
  userId: string;

  /** 签到日（本地时区 YYYY-MM-DD，与配额/邀请同口径） */
  @Column({ type: 'varchar', length: 10 })
  day: string;

  /** 签到当日的连续签到天数 */
  @Column({ type: 'int', default: 1 })
  streak: number;

  @CreateDateColumn({ type: 'timestamp', name: 'create_time' })
  createTime?: Date;
}
