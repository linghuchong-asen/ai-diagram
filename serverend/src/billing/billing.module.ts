// 语图 Task 6 - 按次付费解锁模块
// forFeature 同时注册：unlock_order（本模块）+ project（归属校验/解锁标记），
// 不依赖其他业务模块的 exports（与 projectShare 同模式）。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from '../operationalModules/projectManager/entities/project_manager.entity';
import { UnlockOrderEntity } from './entities/unlock_order.entity';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { XunhupayAdapter } from './adapters/xunhupay.adapter';

@Module({
  imports: [TypeOrmModule.forFeature([UnlockOrderEntity, ProjectEntity])],
  controllers: [BillingController],
  providers: [BillingService, XunhupayAdapter],
})
export class BillingModule {}
