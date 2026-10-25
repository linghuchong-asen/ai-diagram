// 语图 V1.1 - 项目只读分享链接（免登录查看）
// 增长回路核心基础设施：分享卡片/链接 → 他人手机免登录查看 → 注册转化。
// 设计要点：
//   - shareToken：crypto.randomBytes(16) 十六进制 32 字符，不可枚举/猜测；
//   - projectId 唯一：一个项目同一时刻只有一条分享记录（幂等创建，重复点「分享」复用原 token）；
//   - 撤销 = 物理删除记录，token 立即失效，不留脏数据；
//   - 只读边界：公开读取端点仅回传项目名 + 画布 JSON，不含用户 id 等任何归属信息。
import { Column, CreateDateColumn, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('project_share')
export class ProjectShareEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 分享令牌（公开 URL 凭证）：32 位十六进制随机串 */
  @Column({ type: 'varchar', length: 64, unique: true })
  shareToken: string;

  /** 分享的项目 id（project.id，应用层关联无 FK）：唯一约束保证单项目单分享 */
  @Column({ type: 'varchar', length: 64, unique: true })
  projectId: string;

  /** 创建分享的用户（撤销时归属校验；历史数据 NULL 不拦截，与 project.userId 策略一致） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  userId?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  create_time?: Date;
}
