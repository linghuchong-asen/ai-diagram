// 语图 V1.1 - 项目只读分享链接服务
// 职责：创建（幂等）/ 撤销 / 公开读取（免登录）。
// 安全边界：
//   - 创建/撤销均先做项目归属校验（复用 ensureProjectOwner，403 统一文案）；
//   - 公开读取仅凭 shareToken 返回项目名 + 画布 JSON，不回传 userId 等归属信息；
//   - token 由 crypto.randomBytes(16) 生成，128 bit 熵不可穷举。
import { randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureProjectOwner } from '../projectManager/project-ownership';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { ProjectShareEntity } from './entities/project_share.entity';
// Task 2/4:分享获赠配额 + 增长埋点(QuotaService 经 AiModule 导出注入)
import { QuotaService } from '../../ai/quota/quota.service';
import { GrowthEventService } from '../../observability/growth-event.service';

/** 免登录公开读取回传内容（刻意最小化：只给渲染画布所需字段） */
export interface ShareView {
  projectName: string;
  editorData: unknown[];
  /** Task 6:项目是否已付费解锁（前端展示解锁态用；历史行 NULL 视为未解锁） */
  unlocked: boolean;
}

@Injectable()
export class ProjectShareService {
  constructor(
    @InjectRepository(ProjectShareEntity)
    private readonly shareRepository: Repository<ProjectShareEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(EditorDocumentEntity)
    private readonly editorDocumentRepository: Repository<EditorDocumentEntity>,
    /* Task 2:首次分享成功发放当日生成奖励(+1,日上限 3,grantShareBonus 内部旁路容错) */
    private readonly quotaService: QuotaService,
    /* Task 4:增长埋点(share_create 事件) */
    private readonly growthEvent: GrowthEventService,
  ) {}

  /**
   * 创建分享（幂等）：同一项目重复调用复用已有 token，避免链接变更打断已传播的分享。
   * 返回 null 表示项目不存在（controller 转 404）。
   * Task 2/4:仅「新建 token 首次创建成功」分支发放分享奖励并记 share_create 埋点
   * （幂等复用分支不奖励、不重复埋点,防止刷奖励）。
   */
  async createShare(
    projectId: string,
    userId: string | null | undefined,
  ): Promise<{ shareToken: string } | null> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });
    if (!project) return null;
    ensureProjectOwner(project.userId, userId);

    const existing = await this.shareRepository.findOne({
      where: { projectId },
    });
    if (existing) return { shareToken: existing.shareToken };

    const shareToken = randomBytes(16).toString('hex');
    await this.shareRepository.save(
      this.shareRepository.create({ shareToken, projectId, userId: userId ?? null }),
    );
    // 首次创建成功:奖励 + 埋点(奖励失败只告警,不影响分享主链路)
    if (userId) {
      await this.quotaService.grantShareBonus(String(userId));
    }
    this.growthEvent.track('share_create', { userId: userId ?? null, projectId });
    return { shareToken };
  }

  /**
   * 公开读取（免登录）：凭 token 取项目名 + 画布 JSON。
   * 分享不存在/已撤销/内容缺失 → 404 统一文案「分享链接不存在或已失效」。
   */
  async viewShare(token: string): Promise<ShareView> {
    const share = await this.shareRepository.findOne({
      where: { shareToken: token },
    });
    if (!share) {
      throw new HttpException('分享链接不存在或已失效', HttpStatus.NOT_FOUND);
    }

    const doc = await this.editorDocumentRepository.findOne({
      where: { projectId: share.projectId },
    });
    if (!doc) {
      throw new HttpException('分享链接不存在或已失效', HttpStatus.NOT_FOUND);
    }

    const project = await this.projectRepository.findOne({
      select: ['id', 'project_name', 'unlocked'],
      where: { id: share.projectId },
    });

    return {
      projectName: project?.project_name ?? '分享的流程图',
      editorData: Array.isArray(doc.editorData) ? doc.editorData : [],
      // Task 6:回传解锁态（历史行 NULL 视为未解锁）
      unlocked: project?.unlocked === true,
    };
  }

  /**
   * 撤销分享：物理删除记录，token 立即失效。
   * 返回 true 表示删除了记录；项目不存在 → null（controller 转 404）。
   */
  async revokeShare(
    projectId: string,
    userId: string | null | undefined,
  ): Promise<boolean | null> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });
    if (!project) return null;
    ensureProjectOwner(project.userId, userId);

    const result = await this.shareRepository.delete({ projectId });
    return (result.affected ?? 0) > 0;
  }
}
