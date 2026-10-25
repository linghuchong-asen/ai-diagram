/*
 * @Description: 编辑器文档实体(原 MongoDB editorData 集合,迁移至 PostgreSQL jsonb)
 * @Date: 2025-08-13
 */
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('editor_document')
export class EditorDocumentEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 64, unique: true })
  projectId: string;

  @Column({ type: 'varchar', length: 255, unique: true })
  projectName: string;

  // 由 antv X6 的 cell 组成的数组,存入 jsonb 列
  @Column({ type: 'jsonb', default: () => "'[]'::jsonb" })
  editorData: any[];

  @UpdateDateColumn({ type: 'timestamp' })
  update_time?: Date;
}
