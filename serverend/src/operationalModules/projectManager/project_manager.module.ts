import { Module } from '@nestjs/common';
import { ProjectManagerController } from './project_manager.controller';
import { ProjectManagerService } from './project_manager.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProjectEntity } from './entities/project_manager.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { EditorDocumentModule } from '../editorDocument/editor_document.module';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import { ProjectSearchModule } from '../projectSearch/project_search.module';

@Module({
  /*TypeOrmModule.forFeature方法的主要作用是将指定的实体（如PostsEntity)注册到当前的Nst]S模块中，以便在该模块中可以直接注入和使用这些实体*/
  imports: [
    // UserEntity:商业化闭环批次,findById 读归属人会员态(在期 → 项目回传 unlocked=true)
    TypeOrmModule.forFeature([ProjectEntity, EditorDocumentEntity, UserEntity]),
    EditorDocumentModule,
    /* 全文检索索引维护(tsvector + GIN)，create/update/remove 时同步索引 */
    ProjectSearchModule,
  ],
  controllers: [ProjectManagerController],
  providers: [ProjectManagerService],
})
export class ProjectManagerModule {}
