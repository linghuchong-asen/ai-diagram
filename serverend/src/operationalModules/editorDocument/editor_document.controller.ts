import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EditorDocumentService } from './editor_document.service';
import { JwtAuthGuard } from 'src/auth/auth.guard';
import type { SaveEditorDocumentDto } from './dto/save_editor_document.dto';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { ensureProjectOwner } from '../projectManager/project-ownership';

@Controller('editor') // 参数为路径
export class EditorDocumentController {
  constructor(
    private readonly editorDocumentService: EditorDocumentService,
    /* Task 11.2:归属校验需要查项目归属(editor_data 通过 projectId 关联 project) */
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
  ) {}

  /** Task 11.2:projectId 归属校验 —— 当前用户 ≠ 项目归属 → 403(统一文案,不泄露资源存在性) */
  private async assertProjectOwnership(projectId: string, userId?: string): Promise<void> {
    if (!projectId || !userId) return;
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });
    ensureProjectOwner(project?.userId, userId);
  }

  /** 保存编辑器文档 */
  @Post('saveEditorData')
  @UseGuards(JwtAuthGuard)
  async saveEditorDocument(@Body() editorDocument: SaveEditorDocumentDto, @Req() req) {
    await this.assertProjectOwnership(editorDocument.projectId, req?.user?.id);
    const translateMongoData = {
      projectName: editorDocument.projectName,
      projectId: editorDocument.projectId,
      editorData: editorDocument.editorData,
    };
    return await this.editorDocumentService.save(translateMongoData);
  }

  /** 获取编辑器文档 */
  /* :id是路径参数占位符，客户端发送一个 GET 请求到 /somePath/123 时，这个处理器会被触发，并且 id 参数会被解析为 123。 */
  /* @Query() 装饰器用于从 HTTP 请求的查询字符串中提取参数。它可以从请求 URL 中获取所有查询参数，并将它们作为对象传递给方法参数 query。例如，如果请求 URL 是 http://example.com/api/posts?filter=active&page=1，那么 query 将是一个包含 filter 和 page 属性的对象 */
  /* @Query获取查询参数，用于get,delete请求, @Param是获取指定路由参数,不能用于获取查询参数，用于get、post、put、delete请求体参数*/
  @Get('getEditorById/:id')
  @UseGuards(JwtAuthGuard)
  async getEditorDocument(@Param('id') id: string, @Req() req) {
    // Task 11.2:查询前校验 projectId 归属
    await this.assertProjectOwnership(id, req?.user?.id);
    const result = await this.editorDocumentService.getDocumentById(id);
    return result;
  }

  /** 根据id删除文档 */
  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  async deleteDocumentById(@Param('id') id: string, @Req() req) {
    // Task 11.2:删除前校验 projectId 归属(:id 即 projectId,见 service.removeById)
    await this.assertProjectOwnership(id, req?.user?.id);
    return await this.editorDocumentService.removeById(id);
  }
}
