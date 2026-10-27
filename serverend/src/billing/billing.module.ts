// 语图 - 计费模块：按次解锁（Task 6）+ 会员月卡 + 模拟支付 + 营收看板（商业化闭环批次）
// forFeature 注册：unlock_order / vip_order（本模块订单表）+ project（归属校验/
// 解锁标记）+ user（会员到期时间 / 营收看板在期会员数）。
// 支付通道按环境工厂注入：PAY_CHANNEL=mock → MockPayAdapter（沙箱演示，
// 须同时配置 MOCK_PAY_SECRET）；否则默认 XunhupayAdapter（真实通道）。
// 用工厂而非条件模块：两条通道都注册为 provider，工厂只挑实例，
// 保持「未配置通道回落 sponsor 降级」的既有语义不变。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../operationalModules/projectManager/entities/project_manager.entity';
import { UserEntity } from '../user/entities/user.entity';
import { AiDailyUsageEntity } from '../ai/quota/ai-daily-usage.entity';
import { UnlockOrderEntity } from './entities/unlock_order.entity';
import { VipOrderEntity } from './entities/vip_order.entity';
import { InviteMilestoneEntity } from './entities/invite-milestone.entity';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { XunhupayAdapter } from './adapters/xunhupay.adapter';
import { MockPayAdapter, mockPayEnabled } from './adapters/mock-pay.adapter';
import { PAYMENT_ADAPTER } from './payment-adapter.token';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      UnlockOrderEntity,
      VipOrderEntity,
      ProjectEntity,
      UserEntity,
      // AiDailyUsageEntity：邀请裂变批次，邀请奖励日上限计数与欢迎礼走 usage 表
      AiDailyUsageEntity,
      // InviteMilestoneEntity：留存与裂变加强批次，阶梯邀请里程碑领取记录
      InviteMilestoneEntity,
    ]),
  ],
  controllers: [BillingController],
  providers: [
    BillingService,
    XunhupayAdapter,
    MockPayAdapter,
    {
      provide: PAYMENT_ADAPTER,
      useFactory: (xunhu: XunhupayAdapter, mock: MockPayAdapter) =>
        mockPayEnabled() ? mock : xunhu,
      inject: [XunhupayAdapter, MockPayAdapter],
    },
  ],
  // UserModule / AiModule imports 本模块取 BillingService（邀请奖励 / 签到连签会员天数）；
  // 本模块不 import 二者，无循环依赖
  exports: [BillingService],
})
export class BillingModule {}
