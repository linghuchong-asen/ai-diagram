// 语图 Task 6 - 按次付费解锁订单实体
// 设计要点：
//   - id 为 uuid，插入前由 crypto.randomUUID() 显式生成（应用层生成，不依赖 DB 默认值）；
//   - projectId 与 project.id（bigint）类型对齐，应用层关联无外键（与 project_share 一致）；
//   - status 取值 'pending' | 'paid'，状态机单向 pending → paid，无退款流；
//   - channelOrderNo 为通道侧订单号（虎皮椒回调带回），验签通过后回填，用于对账。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('unlock_order')
@Index('idx_unlock_order_user', ['userId'])
@Index('idx_unlock_order_project', ['projectId'])
export class UnlockOrderEntity {
  /** 订单号（uuid，插入前 crypto.randomUUID() 生成） */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** 解锁的项目 id（与 project.id 对齐的 bigint；应用层关联无 FK） */
  @Column({ type: 'bigint' })
  projectId: string;

  /** 下单用户（须与 project.userId 归属一致，越权统一 404） */
  @Column({ type: 'varchar', length: 64 })
  userId: string;

  /** 金额（单位：分。只信服务端 env UNLOCK_PRICE_FEN，不接受前端传金额） */
  @Column({ type: 'int' })
  amount: number;

  /** 订单状态：pending 待支付 / paid 已支付（无退款流） */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'paid';

  /** 支付通道（当前仅虎皮椒 xunhupay） */
  @Column({ type: 'varchar', length: 32, default: 'xunhupay' })
  channel: string;

  /** 通道侧订单号（回调验签通过后回填；未支付为 NULL） */
  @Column({ type: 'varchar', length: 128, nullable: true })
  channelOrderNo?: string | null;

  @CreateDateColumn({ type: 'timestamp' })
  create_time?: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  update_time?: Date;
}
