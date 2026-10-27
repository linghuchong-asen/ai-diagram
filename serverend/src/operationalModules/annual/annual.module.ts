// 语图代码年报（Round B）模块
// 公开只读端点，无数据库实体；GrowthEventService 由 @Global ObservabilityModule 提供。
import { Module } from '@nestjs/common';
import { AnnualController } from './annual.controller';
import { AnnualService } from './annual.service';

@Module({
  controllers: [AnnualController],
  providers: [AnnualService],
  exports: [AnnualService],
})
export class AnnualModule {}
