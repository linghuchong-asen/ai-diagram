import {
  Body,
  ClassSerializerInterceptor,
  Controller,
  Delete,
  Get,
  Header,
  Headers,
  HttpException,
  Logger,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ProjectRo, ProjectManagerService } from './project_manager.service';
import { CreateProjectDto } from './dto/create_project.dto';
import { ProjectEntity } from './entities/project_manager.entity';
import { plainToInstance } from 'class-transformer';
import { JwtAuthGuard } from 'src/auth/auth.guard';
import * as path from 'path';
import * as fs from 'fs';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { join } from 'path';
import { SkipInterceptor } from 'src/core/interceptor/skip.interceptor';

const logger = new Logger('ProjectController');

@Controller('project') // 路径为/project
/* Task 11.2:项目路由启用 JWT 鉴权(security.md 鉴权与数据隔离) */
@UseGuards(JwtAuthGuard)
export class ProjectManagerController {
  constructor(private readonly projectService: ProjectManagerService) {}

  /** 当前登录用户 id(JwtStrategy.validate 返回值挂在 req.user) */
  private currentUserId(req: any): string | undefined {
    return req?.user?.id != null ? String(req.user.id) : undefined;
  }

  /** 新建项目 */
  /* @Body() 它的主要作用是从 HTTP 请求的请求体（Request Body）中提取数据，并将其传递给控制器方法中的参数。*/
  @Post()
  @UseInterceptors(ClassSerializerInterceptor)
  async create(@Body() project: CreateProjectDto, @Req() req) {
    /* note：在 controller 中接收到的参数不会完成@Expose 中重新定义的字段名，且接收到的参数还是普通对象，在使用 plainToInStance(), instanceToPlain()方法时会完成字段名名的转换； */
    const projectEntityParam = plainToInstance(ProjectEntity, project);
    /* Task 11.2:记录项目归属(创建人),供后续越权校验使用 */
    projectEntityParam.userId = this.currentUserId(req);
    const createResult = await this.projectService.create(projectEntityParam);
    return createResult;
  }

  /** 获取项目列表 */
  @Get()
  /* @Query() 装饰器用于从 HTTP 请求的查询字符串中提取参数。它可以从请求 URL 中获取所有查询参数，并将它们作为对象传递给方法参数 query。例如，如果请求 URL 是 http://example.com/api/posts?filter=active&page=1，那么 query 将是一个包含 filter 和 page 属性的对象 */
  @UseInterceptors(ClassSerializerInterceptor)
  async findAll(@Query() query, @Req() req): Promise<ProjectRo> {
    const { pageSize, pageNumber } = query;
    const findResult = await this.projectService.findAll(
      {
        pageSize,
        pageNumber,
      },
      this.currentUserId(req),
    );
    return findResult;
  }



  /** 更新项目信息
   * @param id
   * @param post */
  @Put(':id')
  async update(@Param('id') id, @Body() post, @Req() req) {
    return await this.projectService.updateById(id, post, this.currentUserId(req));
  }

  /** 删除项目
   *  @param id
   */
  @Delete('delProject')
  async remove(@Query() reqParams, @Req() req) {
    const { projectIds } = reqParams;
    return await this.projectService.removeById(projectIds, this.currentUserId(req));
  }

  /** 导出指定项目的编辑器json文件 */
  @Get('editDataFile')
  @SkipInterceptor()
  async exportEditorDataFile(@Query() reqParams, @Req() req) {
    const { projectId } = reqParams;
    const filePath = await this.projectService.exportEditorDataFile(
      projectId,
      this.currentUserId(req),
    );
    if (!filePath) {
      throw new HttpException(`id为${projectId}的项目不存在`, 404);
    }
    // 可以获取带有后缀的文件名，path模块还能不同平台分割符的问题
    const fileName = path.basename(filePath);

    // 读取文件并返回;
    const fileStream = createReadStream(filePath);

    /* 以下是使用express的res的响应方式，使用了express的响应对象，nestjs就失去了对响应对象的控制；
      nestjs文档返回文件流推荐使用StreamableFile对象 */
    // res.set({
    //   'Content-Type': 'application/json',
    //   'Content-Disposition': `attachment; filename=${fileName}`,
    // });
    // fileStream.pipe(res);

    // 下载完成后删除临时文件;
    fileStream.on('end', () => {
      fs.unlinkSync(filePath);
    });
    fileStream.on('error', (err) => {
      logger.error('文件下载失败', err);
      throw new HttpException('文件下载失败', 500);
    });
    return new StreamableFile(fileStream, {
      type: 'application/json',
      disposition: `attachment; filename=${fileName}`, // 浏览器直接访问路由将直接弹出保存窗口
    });
  }

   /** 获取指定项目
   * @param id
   */
  /* 这个路由放在editDataFile路由后面，因为nest的路由是按注册顺序和字面匹配优先规则来的；:id是一个不确定的路由；应该放在确定性路由的后面，不然editDataFile路由会被:id路由错误的拦截到 */
  @Get(':id')
  async findById(@Param('id') id, @Req() req) {
    const projectResult = await this.projectService.findById(id, this.currentUserId(req));
    return projectResult;
  }
}
