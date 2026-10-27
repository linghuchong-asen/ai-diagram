/*
 * @Description: 用户实体
 * @Author: yangsen
 * @Date: 2024-11-11 10:30:10
 * @LastEditors: yangsen
 * @LastEditTime: 2024-11-27 18:40:39
 */
import {
  BeforeInsert,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as path from 'path';
import { Exclude } from 'class-transformer';

export enum RoleEnum {
  ROOT = 'root',
  AUTHOR = 'author',
  VISITOR = 'visitor',
}

@Entity('user') // user即为表名
export class UserEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ length: 100 })
  username: string;

  @Column({ length: 100, default: '' })
  nickname: string;

  @Column()
  @Exclude()
  password: string;

  @Column({ default: path.resolve(__dirname, '../../public/avatar.jpg') })
  avatar: string;

  @Column({ default: '' })
  email: string;

  /**
   * 会员到期时间（商业化闭环批次）：NULL = 从未开通/已过期后由回调重写。
   * 单向叠加：续费在现有未过期时间上 +30 天（见 billing.service 会员回调放行），
   * 不做过期清空（判断是否在期用「与当前时间比较」，历史值保留可对账）。
   */
  @Column({ name: 'vip_expire_time', type: 'timestamp', nullable: true })
  vipExpireTime?: Date | null;

  /**
   * 邀请码（邀请裂变批次）：8 位无歧义字符集，注册 @BeforeInsert 自动生成，
   * 存量用户由 /billing/invite/me 懒生成。PG 唯一索引允许多行 NULL。
   */
  @Column({ name: 'invite_code', type: 'varchar', length: 16, nullable: true })
  @Index('uq_user_invite_code', ['inviteCode'], { unique: true })
  inviteCode?: string | null;

  /** 邀请归因：注册时携带的合法邀请码（= 邀请人的 invite_code），仅记录不重复发奖 */
  @Column({ name: 'invited_by', type: 'varchar', length: 16, nullable: true })
  invitedBy?: string | null;

  /** 新用户注册时自动生成邀请码（存量行为 NULL，懒生成兜底） */
  @BeforeInsert()
  assignInviteCode(): void {
    if (!this.inviteCode) {
      // 延迟 require 避免 entity 模块加载顺序问题；生成器内部自带无歧义字符集
      const { generateInviteCode } = require('../../billing/invite') as {
        generateInviteCode: () => string;
      };
      this.inviteCode = generateInviteCode();
    }
  }

  @Column({
    type: 'enum',
    enum: RoleEnum,
    default: 'visitor',
  })
  role: string; // 用户角色

  @CreateDateColumn({
    name: 'create_time', // 存入数据库的实际是create_time
    type: 'timestamp',
    // default: () => 'CURRENT_TIMESTAMP',
  })
  createTime: Date;

  @UpdateDateColumn({
    name: 'update_time',
    type: 'timestamp',
  })
  updateTime: Date;

  @BeforeInsert()
  async encryptPassword(): Promise<void> {
    // 插入数据库之前执行的方法
    this.password = await bcrypt.hashSync(this.password, 10);
  }
}
