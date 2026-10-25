// 语图 V1.1 - 项目只读分享模块
// forFeature 同时注册三方仓库：分享表（本模块）、project（归属校验）、
// editor_document（公开读取画布 JSON），无需依赖其他业务模块的 exports。
// ShareRateLimitGuard 经 @UseGuards(类) 直接实例化，与 AuthRateLimitGuard 同机制，无需注册 provider。
// Task 2:引入 AiModule 取其导出的 QuotaService（分享获赠 grantShareBonus）；
//         GrowthEventService 来自 @Global 的 ObservabilityModule，无需显式 imports。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { ProjectShareEntity } from './entities/project_share.entity';
import { ProjectShareController } from './project_share.controller';
import { ProjectShareService } from './project_share.service';
import { AiModule } from '../../ai/ai.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectShareEntity,
      ProjectEntity,
      EditorDocumentEntity,
    ]),
    // AiModule 不反向依赖本模块(经 grep 确认无循环),无需 forwardRef
    AiModule,
  ],
  controllers: [ProjectShareController],
  providers: [ProjectShareService],
})
export class ProjectShareModule {}
