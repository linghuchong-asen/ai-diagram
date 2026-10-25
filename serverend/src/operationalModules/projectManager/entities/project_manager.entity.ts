/*
 * @Description:TypeORM是通过实体映射到数据表，所以要建立一个项目实体posts.entity.ts
 * @Author: yangsen
 * @Date: 2022-04-03 22:27:54
 * @LastEditors: yangsen
 * @LastEditTime: 2024-12-02 15:08:17
 */

import { Expose } from 'class-transformer';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('project') // 没有指定表名，则表名默认为类名project_entity
export class ProjectEntity {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  @Expose({ name: 'projectId', toPlainOnly: true })
  id?: string; // 标记为主键，值自动生成

  @Column({ length: 50 })
  /* @Expose中定义的字段名是普通对象用的； project_name是实例对象的字段名 */
  @Expose({ name: 'projectName', toPlainOnly: true })
  project_name: string;

  /* Task 11.2:项目归属用户(创建人),用于越权访问校验(security.md 数据隔离);
   * 历史数据为 NULL,视为未归属不拦截,保证存量项目兼容 */
  @Column({ length: 64, nullable: true })
  @Expose({ name: 'userId', toPlainOnly: true })
  userId?: string | null;

  @Column('text')
  @Expose({ name: 'projectDesc', toPlainOnly: true })
  project_desc: string;

  /* Task 6:按次付费解锁标记 —— 项目是否已付费解锁（unlock_order 支付回调置 true，
   * 单向 false → true，无退款流；公开分享读取会回传该字段用于前端展示解锁态） */
  @Column({ type: 'boolean', default: false })
  @Expose({ name: 'unlocked', toPlainOnly: true })
  unlocked?: boolean;

  @Column({ type: 'timestamp', default: () => 'CURRENT_TIMESTAMP' })
  @Expose({ name: 'createTime', toPlainOnly: true })
  create_time?: Date;

  /* 使用@UpdateDateColumn装饰器会自动更新时间戳 */
  @UpdateDateColumn({ type: 'timestamp' })
  @Expose({ name: 'updateTime', toPlainOnly: true })
  update_time?: Date;
}
