import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ProjectEntity } from './entities/project_manager.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { DataSource, In, Repository } from 'typeorm';
import { EditorDocumentService } from '../editorDocument/editor_document.service';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import * as path from 'path';
import * as fs from 'fs';
import { ConfigService } from '@nestjs/config';
import { ProjectSearchService } from '../projectSearch/project_search.service';
import { ensureProjectOwner } from './project-ownership';
import { isVipActive } from '../../billing/membership';

const logger = new Logger('ProjectService');

export interface ProjectRo {
  page: { total: number; pageSize: number };
  tableData: ProjectEntity[];
}
@Injectable()
export class ProjectManagerService {
  constructor(
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly dataSource: DataSource,
    // 需要使用其他模块的service作为依赖时，要在对应的模块中exports 一下，然后在当前的module文件中imports对应的模块
    private readonly editorDocumentService: EditorDocumentService,
    private readonly configService: ConfigService,
    private readonly projectSearchService: ProjectSearchService,
  ) {}

  /* 新建项目 */
  async create(project: ProjectEntity): Promise<ProjectEntity> {
    // todo: 当没有传project_desc字段时，mysql中会存储为什么
    const { project_name } = project;
    if (!project_name) {
      throw new HttpException('项目名称不能为空', 400);
    }
    const doc = await this.projectRepository.findOne({
      where: { project_name },
    });
    if (doc) {
      throw new HttpException('项目名称已存在', 409);
    }

    /* TypeORM会将查询结果转换为类实例，所以savedProject是一个类实例对象(此处为CreateProjectDto)，返回前端的通常是普通对象 */
    /* save方法返回的实例对象类型是与传入参数一致的，比如传入的的是CreateProjectDto返回的也是CreateProjectDto；传入的ProjectEntity返回的也是ProjectEntity */
    const savedProject = await this.projectRepository.save(project);
    /* 新建项目后同步全文检索索引(索引失败只告警，不影响创建结果) */
    await this.projectSearchService.indexProject(savedProject);
    return savedProject;
  }

  /**  获取项目列表(只返回本人项目 + 未归属的历史项目) */
  async findAll(
    query: {
      pageSize: number;
      pageNumber: number;
    },
    userId?: string,
  ): Promise<ProjectRo> {
    const qb = this.projectRepository.createQueryBuilder('project'); // 数据库表的名字
    qb.where('1=1'); // 1=1 总是为真，不会影响查询结果，但可以作为一个占位符，方便后续添加更多的条件。
    // Task 11.2:数据隔离 —— 仅返回当前用户拥有的项目;user_id 为 NULL 的历史数据保持可见(兼容存量)
    if (userId) {
      qb.andWhere('(project.userId IS NULL OR project.userId = :ownerId)', {
        ownerId: String(userId),
      });
    }
    qb.orderBy('project.update_time', 'DESC'); // DESC是降序的意思，升序：ASC

    const count = await qb.getCount();
    const { pageNumber = 1, pageSize = 10 } = query;
    qb.limit(pageSize); // 可以选择的最大行数
    qb.offset((pageNumber - 1) * pageSize); // 从第几行开始

    try {
      const projects = await qb.getMany();
      return {
        page: { total: count, pageSize },
        tableData: projects,
      };
    } catch (err) {
      logger.error('查询项目列表失败', err);
      throw new HttpException(
        `查询项目列表失败${err}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /** 获取指定项目(Task 11.2:归属校验,越权返回 403 统一文案) */
  async findById(id, userId?: string): Promise<ProjectEntity> {
    // 商业化闭环批次:select 补 unlocked + userId —— 此前 unlocked 未查出,
    // 付费解锁后预览页刷新仍拿到 undefined,水印永不消失(付费闭环断点);
    // userId 未查出则 ensureProjectOwner 形同虚设(任意登录用户可读任意项目)。
    const project = await this.projectRepository.findOne({
      select: ['id', 'project_name', 'project_desc', 'unlocked', 'userId'],
      where: { id }, // 查询id符合条件的行
    });
    ensureProjectOwner(project?.userId, userId);
    // 会员免水印(商业化闭环批次):归属人在会员有效期内 → 视为已解锁(仅回传,不落库)
    if (project && project.unlocked !== true && project.userId) {
      const owner = await this.userRepository.findOne({
        where: { id: String(project.userId) },
        select: ['id', 'vipExpireTime'],
      });
      if (isVipActive(owner?.vipExpireTime)) {
        project.unlocked = true;
      }
    }
    return project;
  }

  /** 更新项目(Task 11.2:归属校验) */
  async updateById(id, project, userId?: string): Promise<ProjectEntity> {
    const existProject = await this.projectRepository.findOne({
      where: { id },
    });
    if (!existProject) {
      throw new HttpException(`id为${id}的项目不存在`, 401);
    }
    ensureProjectOwner(existProject.userId, userId);
    const updateProject = this.projectRepository.merge(existProject, project);
    const savedProject = await this.projectRepository.save(updateProject);
    /* 项目名/描述变更后刷新全文检索索引 */
    await this.projectSearchService.indexProject(savedProject);
    return savedProject;
  }

  /** 删除项目(Task 11.2:批量归属校验,任一项目归属他人 → 403 统一文案) */
  async removeById(ids: string[], userId?: string): Promise<any> {
    // 兼容单个 id 与数组两种入参(前端 delProject 以 query 参数传 projectIds 数组)
    const idList = (Array.isArray(ids) ? ids : [ids])
      .filter((id) => id !== undefined && id !== null && id !== '')
      .map((id) => String(id));
    if (!idList.length) {
      throw new HttpException('项目id不能为空', HttpStatus.BAD_REQUEST);
    }

    // dataSource默认使用typeORM链接的数据库
    const queryRunner = this.dataSource.createQueryRunner();
    try {
      await queryRunner.startTransaction();
      /* 批量存在性校验，避免逐条 findOne 造成 N+1 查询 */
      const existProjects = await queryRunner.manager.find(ProjectEntity, {
        where: { id: In(idList) },
      });
      if (existProjects.length !== idList.length) {
        const missingIds = idList.filter(
          (id) => !existProjects.some((item) => String(item.id) === id),
        );
        throw new HttpException(
          `id为${missingIds.join(',')}的项目不存在`,
          HttpStatus.UNAUTHORIZED,
        );
      }
      /* Task 11.2:归属校验 —— 任一待删项目归属他人即整体拒绝(不指明哪条,不泄露存在性) */
      for (const project of existProjects) {
        ensureProjectOwner(project.userId, userId);
      }

      /* 文档与项目同处 PostgreSQL，在同一事务中批量删除，保证原子性 */
      await queryRunner.manager.delete(EditorDocumentEntity, {
        projectId: In(idList),
      });
      const deleted = await queryRunner.manager.delete(ProjectEntity, {
        id: In(idList),
      });

      await queryRunner.commitTransaction();
      /* 索引属于派生数据，放在事务提交之后清理：提交失败则不产生索引空洞 */
      await this.projectSearchService.removeIndex(idList);
      return [deleted];
    } catch (err) {
      await queryRunner.rollbackTransaction();
      logger.error('删除项目失败', err);
      if (err instanceof HttpException) {
        throw err;
      }
      throw new HttpException(
        `删除项目失败${err}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    } finally {
      // 完成操作，释放queryRunner以避免资源泄露
      await queryRunner.release();
    }
  }

  /** 导出指定项目的编辑器json文件(Task 11.2:归属校验) */
  async exportEditorDataFile(projectId: string, userId?: string) {
    try {
      /* 归属校验:项目存在且归属他人 → 403;项目不存在时保持原有 401 文案 */
      const project = await this.projectRepository.findOne({
        where: { id: projectId },
      });
      ensureProjectOwner(project?.userId, userId);
      const editorDocument = await this.editorDocumentService.getDocumentById(
        projectId,
      );
      if (!editorDocument) {
        throw new HttpException(`id为${projectId}的项目不存在`, 401);
      }

      // 创建临时文件路径
      // todo:改成从变量或者从环境变量读取，nestjs中有全局变量一说吗？
      // const tempFilePath = this.configService.get('TEMP_FILE_PATH');
      // if (!tempFilePath) throw new Error('未设置临时文件路径');
      const filePath = path.resolve(__dirname, '../../../../tempFiles'); // 运行时是在dist目录下
      logger.log(`临时文件路径为${filePath}`);
      const date = new Date();
      // getMonth() 返回 0-11，需要 +1 才是真实月份
      const createTime = `${date.getFullYear()}-${(date.getMonth() + 1)
        .toString()
        .padStart(2, '0')}-${date.getDate().toString().padStart(2, '0')}-${date
        .getHours()
        .toString()
        .padStart(2, '0')}-${date
        .getMinutes()
        .toString()
        .padStart(2, '0')}-${date.getSeconds().toString().padStart(2, '0')}`;
      const fileName = `${createTime}_${projectId}.json`;
      const fileFullPath = path.join(filePath, fileName);

      const editorData = JSON.stringify(editorDocument.editorData, null, 2);
      // 写入临时文件(异步写,避免大文档导出时阻塞事件循环)
      await fs.promises.writeFile(fileFullPath, editorData, { encoding: 'utf-8' });

      return fileFullPath;
    } catch (err) {
      logger.error('导出项目失败', err);
      if (err instanceof HttpException) {
        throw err;
      } else {
        throw new HttpException(`导出项目失败${err}`, 500);
      }
    }
  }
}
