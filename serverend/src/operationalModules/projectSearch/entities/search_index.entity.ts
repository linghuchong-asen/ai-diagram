/*
 * @Description: 全文检索索引表(PostgreSQL 原生 tsvector + GIN，不引入 ES 等外部依赖)
 */
import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

export const SEARCH_INDEX_TABLE = 'search_index';
/* GIN 索引名：TypeORM 的 @Index 无法声明 USING GIN，改为模块启动时用原生 SQL 幂等创建 */
export const SEARCH_VECTOR_INDEX_NAME = 'idx_search_index_vector_gin';

@Entity(SEARCH_INDEX_TABLE)
export class SearchIndexEntity {
  /* 与 project.id / editor_document.projectId 一一对应，作为主键便于 upsert */
  @PrimaryColumn({ name: 'project_id', type: 'varchar', length: 64 })
  projectId: string;

  @Column({ name: 'project_name', type: 'varchar', length: 255, default: '' })
  projectName: string;

  @Column({ name: 'project_desc', type: 'text', nullable: true })
  projectDesc: string;

  /* 编辑器画布中抽取出的可读文本(节点 label、shape 等)，保存文档时更新 */
  @Column({ name: 'content_text', type: 'text', nullable: true })
  contentText: string;

  /* 由应用层写入时通过 to_tsvector('simple', ...) 计算，配合 GIN 索引检索 */
  @Column({
    name: 'search_vector',
    type: 'tsvector',
    nullable: true,
    select: false,
  })
  searchVector: string;

  @UpdateDateColumn({ name: 'update_time', type: 'timestamp' })
  updateTime?: Date;
}
