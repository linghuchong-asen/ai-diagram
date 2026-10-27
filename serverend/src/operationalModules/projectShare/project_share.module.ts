// 语图 V1.1 - 项目只读分享模块
// forFeature 同时注册四方仓库：分享表（本模块）、project（归属校验）、
// editor_document（公开读取画布 JSON）、user（商业化闭环批次：owner 会员态判定）。
// ShareRateLimitGuard 经 @UseGuards(类) 直接实例化，与 AuthRateLimitGuard 同机制，无需注册 provider。
// Task 2:引入 AiModule 取其导出的 QuotaService（分享获赠 grantShareBonus）；
//         GrowthEventService 来自 @Global 的 ObservabilityModule，无需显式 imports。
// 商业化闭环批次:引入 AuthModule 取其导出的 jwtModule —— viewShare 可选 JWT 识别 owner。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { CommunityTemplateEntity } from '../template/entities/community-template.entity';
import { TemplateCopyRewardEntity } from '../template/entities/template-copy-reward.entity';
import { ProjectShareEntity } from './entities/project_share.entity';
import { ProjectShareController } from './project_share.controller';
import { ProjectShareService } from './project_share.service';
import { AiModule } from '../../ai/ai.module';
import { AuthModule } from '../../auth/auth.module';
// 投稿激励批次:复制里程碑送会员天数经 BillingModule 的 grantVipDays（无循环依赖）
import { BillingModule } from '../../billing/billing.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      ProjectShareEntity,
      ProjectEntity,
      EditorDocumentEntity,
      UserEntity,
      // 模板使用统计批次：社区模板 view/copy 计数
      CommunityTemplateEntity,
      // 投稿激励批次：复制里程碑领取记录
      TemplateCopyRewardEntity,
    ]),
    // AiModule 不反向依赖本模块(经 grep 确认无循环),无需 forwardRef
    AiModule,
    // AuthModule 仅导出 jwtModule(viewShare 可选鉴权用),无循环依赖
    AuthModule,
    // 投稿激励批次:grantVipDays
    BillingModule,
  ],
  controllers: [ProjectShareController],
  providers: [ProjectShareService],
})
export class ProjectShareModule {}
