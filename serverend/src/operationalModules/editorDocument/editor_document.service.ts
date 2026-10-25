import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EditorDocumentEntity } from './entities/editor_document.entity';
import { ProjectSearchService } from '../projectSearch/project_search.service';

const logger = new Logger('EditorDocumentService');

@Injectable()
export class EditorDocumentService {
  constructor(
    @InjectRepository(EditorDocumentEntity)
    private readonly editorDocumentRepository: Repository<EditorDocumentEntity>,
    private readonly projectSearchService: ProjectSearchService,
  ) {}

  /** 保存编辑器文档(按 projectId upsert) */
  async save(editorDocumentData: Partial<EditorDocumentEntity>) {
    const projectId = editorDocumentData.projectId;
    try {
      const existProject = await this.editorDocumentRepository.findOne({
        where: { projectId },
      });
      if (existProject) {
        // 更新文档
        await this.editorDocumentRepository.update(
          { projectId },
          {
            projectName: editorDocumentData.projectName,
            editorData: editorDocumentData.editorData,
          },
        );
        /* 画布内容变化后追加/更新全文检索索引(索引内部已捕获异常，不影响保存结果) */
        await this.projectSearchService.indexEditorDocument(editorDocumentData);
        return {};
      } else {
        // 创建文档
        const createDocument = this.editorDocumentRepository.create(
          editorDocumentData as EditorDocumentEntity,
        );
        const saveResult = await this.editorDocumentRepository.save(
          createDocument,
        );
        if (saveResult) {
          await this.projectSearchService.indexEditorDocument(
            editorDocumentData,
          );
          return {};
        }
      }
    } catch (err) {
      logger.error('保存文档失败', err);
      throw new HttpException('保存文档失败', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  /** 根据项目id获取编辑器文档 */
  async getDocumentById(id: string): Promise<EditorDocumentEntity | null> {
    try {
      return await this.editorDocumentRepository.findOne({
        where: { projectId: id },
      });
    } catch (err) {
      logger.error('根据id获取编辑器文档', err);
      throw new HttpException('无效的文档 ID', HttpStatus.BAD_REQUEST);
    }
  }

  /** 根据项目id删除数据 */
  async removeById(projectId: string): Promise<any> {
    try {
      const result = await this.editorDocumentRepository.delete({ projectId });
      /* 文档删除后同步清理检索索引 */
      await this.projectSearchService.removeIndex([projectId]);
      return result;
    } catch (err) {
      logger.error('根据id删除文档', err);
      throw new HttpException(
        `根据id删除文档失败${err}`,
        HttpStatus.BAD_REQUEST,
      );
    }
  }
}
