import { Module, OnModuleInit } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SearchIndexEntity } from './entities/search_index.entity';
import { ProjectSearchService } from './project_search.service';
import { ProjectSearchController } from './project_search.controller';

/*
 * 全文检索模块：基于 PostgreSQL 原生 tsvector + GIN，无需 Elasticsearch 等外部依赖。
 * 由 ProjectManagerModule / EditorDocumentModule 引入，在项目创建、更新、画布保存、项目删除时维护索引。
 */
@Module({
  imports: [TypeOrmModule.forFeature([SearchIndexEntity])],
  controllers: [ProjectSearchController],
  providers: [ProjectSearchService],
  exports: [ProjectSearchService],
})
export class ProjectSearchModule implements OnModuleInit {
  constructor(private readonly searchService: ProjectSearchService) {}

  /* synchronize 只负责建表建列，GIN 索引在此幂等补齐 */
  async onModuleInit() {
    await this.searchService.ensureGinIndex();
  }
}
