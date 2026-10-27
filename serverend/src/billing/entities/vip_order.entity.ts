// 语图商业化闭环批次 - 会员月卡订单实体
// 与 unlock_order 同构（uuid 订单号 / 服务端定价 / pending→paid 单向 / 回调验签放行），
// 差异：没有 projectId（会员是用户级权益），paid 后权益落 user.vip_expire_time
// （叠加规则见 billing.service）。sku 预留扩展位（年卡/季卡后续只加枚举值）。
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('vip_order')
@Index('idx_vip_order_user', ['userId'])
export class VipOrderEntity {
  /** 订单号（uuid，插入前 crypto.randomUUID() 生成） */
  @PrimaryColumn({ type: 'uuid' })
  id: string;

  /** 下单用户 */
  @Column({ type: 'varchar', length: 64 })
  userId: string;

  /** SKU（当前仅 vip_month 月卡；年卡/季卡后续扩展） */
  @Column({ type: 'varchar', length: 32, default: 'vip_month' })
  sku: string;

  /** 金额（单位：分。只信服务端 env VIP_MONTH_PRICE_FEN / VIP_MONTH_FIRST_PRICE_FEN） */
  @Column({ type: 'int' })
  amount: number;

  /** 订单状态：pending 待支付 / paid 已支付（无退款流） */
  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: 'pending' | 'paid';

  /** 支付通道（xunhupay / mock，随工厂选择落库，便于对账） */
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
