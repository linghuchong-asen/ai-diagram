// 语图社区模板批次 - 社区模板实体（用户作品投稿 → 审核后上模板中心长尾）
// 设计要点：
//   - projectId 唯一：一个项目只能投稿一次（防重复灌水；驳回后删除记录可重投）；
//   - shareToken 复用 V1.1 分享体系：社区模板「查看成品」直接跳 /share/:token，
//     页内自带的复制/注册转化动线零成本复用；投稿时无分享则代建（不发分享奖励）；
//   - status 审核单向 pending → approved | rejected（合规红线：UGC 必审后上架）；
//   - ownerName 为投稿时昵称快照（用户改名不回溯，展示用）。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('community_template')
@Index('idx_community_template_status', ['status'])
export class CommunityTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 投稿的项目 id（project.id，应用层关联无 FK；唯一约束在迁移/索引层由业务保证） */
  @Column({ type: 'varchar', length: 64, unique: true })
  projectId: string;

  /** 投稿人（归属校验用） */
  @Column({ type: 'varchar', length: 64, name: 'owner_id' })
  ownerId: string;

  /** 署名快照（投稿时昵称，展示用） */
  @Column({ type: 'varchar', length: 50, name: 'owner_name', default: '' })
  ownerName: string;

  /** 模板标题（默认项目名，投稿时可改，≤50 字符与 project_name 列宽一致） */
  @Column({ type: 'varchar', length: 50 })
  title: string;

  /** 一句话场景说明（≤120 字符，给浏览者看） */
  @Column({ type: 'varchar', length: 120, default: '' })
  description: string;

  /** 成品分享令牌（复用 /share/:token 免登录查看） */
  @Column({ type: 'varchar', length: 64, name: 'share_token' })
  shareToken: string;

  /** 审核状态：pending 待审 / approved 已上架 / rejected 已驳回（单向） */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'approved' | 'rejected';

  /** 成品页被查看次数（分享 view 链路原子自增；模板使用统计批次） */
  @Column({ type: 'int', name: 'view_count', default: 0 })
  viewCount: number;

  /** 被复制次数（share_duplicate 链路原子自增；最强使用意图信号） */
  @Column({ type: 'int', name: 'copy_count', default: 0 })
  copyCount: number;

  @CreateDateColumn({ type: 'timestamp', name: 'create_time' })
  createTime?: Date;
}
