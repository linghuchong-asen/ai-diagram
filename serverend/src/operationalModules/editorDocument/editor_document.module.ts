/*
 * @Description: 编辑器数据保存模块
 * @Author: yangsen
 * @Date: 2022-04-19 09:31:59
 * @LastEditors: yangsen
 * @LastEditTime: 2025-06-13 11:19:15
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EditorDocumentEntity } from './entities/editor_document.entity';
import { EditorDocumentController } from './editor_document.controller';
import { EditorDocumentService } from './editor_document.service';
import { ProjectSearchModule } from '../projectSearch/project_search.module';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';

/* 编辑器文档保存至 PostgreSQL jsonb 模块 */
@Module({
  imports: [
    // forFeature 方法在 NestJS 中用于注册指定的 TypeORM 实体到模块中,使得这些实体可以在模块内的服务中被注入和使用。
    // ProjectEntity:Task 11.2 controller 归属校验需要按 projectId 查项目归属
    TypeOrmModule.forFeature([EditorDocumentEntity, ProjectEntity]),
    /* 保存画布数据时同步全文检索索引 */
    ProjectSearchModule,
  ],
  controllers: [EditorDocumentController],
  providers: [EditorDocumentService],
  exports: [EditorDocumentService],
})
export class EditorDocumentModule {}
