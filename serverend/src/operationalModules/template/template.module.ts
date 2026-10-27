// 语图 Task 7 - 模板中心模块
// 官方预置模板纯静态（无表无迁移）；社区模板批次新增 community_template /
// project / project_share 三仓库（投稿/归属校验/分享 token 复用），不依赖其他业务模块 exports。
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommunityTemplateEntity } from './entities/community-template.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { ProjectShareEntity } from '../projectShare/entities/project_share.entity';
import { TemplateController } from './template.controller';
import { TemplateService } from './template.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CommunityTemplateEntity,
      ProjectEntity,
      ProjectShareEntity,
    ]),
  ],
  controllers: [TemplateController],
  providers: [TemplateService],
})
export class TemplateModule {}
