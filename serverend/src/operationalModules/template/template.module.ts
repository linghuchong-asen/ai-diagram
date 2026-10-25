// 语图 Task 7 - 模板中心模块
// 纯静态预置数据（12 个高频模板硬编码），无表无迁移，不依赖其他业务模块。
import { Module } from '@nestjs/common';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}
