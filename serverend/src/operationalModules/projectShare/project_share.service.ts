// 语图 V1.1 - 项目只读分享链接服务
// 职责：创建（幂等）/ 撤销 / 公开读取（免登录）/ 复制为我的项目（快赢批次一）。
// 安全边界：
//   - 创建/撤销均先做项目归属校验（复用 ensureProjectOwner，403 统一文案）；
//   - 公开读取仅凭 shareToken 返回项目名 + 画布 JSON，不回传 userId 等归属信息；
//   - token 由 crypto.randomBytes(16) 生成，128 bit 熵不可穷举。
import { randomBytes } from 'crypto';
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import { ensureProjectOwner } from '../projectManager/project-ownership';
import { EditorDocumentEntity } from '../editorDocument/entities/editor_document.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { UserEntity } from '../../user/entities/user.entity';
import { ProjectShareEntity } from './entities/project_share.entity';
// 模板使用统计批次:社区模板热度计数（view/copy 原子自增）
import { CommunityTemplateEntity } from '../template/entities/community-template.entity';
// 投稿激励批次:复制里程碑常量与领取记录（跨档自动送投稿人会员天数）
import { COMMUNITY_COPY_MILESTONES } from '../template/community-rewards';
import { TemplateCopyRewardEntity } from '../template/entities/template-copy-reward.entity';
import { BillingService } from '../../billing/billing.service';
// Task 2/4:分享获赠配额 + 增长埋点(QuotaService 经 AiModule 导出注入)
import { QuotaService } from '../../ai/quota/quota.service';
import { GrowthEventService } from '../../observability/growth-event.service';
// 商业化闭环批次:owner 会员在期 → 分享页/导出全链路免水印;可选 JWT 识别 owner
import { isVipActive } from '../../billing/membership';

/** 免登录公开读取回传内容（刻意最小化：只给渲染画布所需字段） */
export interface ShareView {
  projectName: string;
  editorData: unknown[];
  /** Task 6:项目是否已付费解锁（前端展示解锁态用；历史行 NULL 视为未解锁） */
  unlocked: boolean;
  /** 商业化闭环批次:仅当访客(带合法 JWT)就是项目归属人时回传 true,其余情况一律不带该字段 */
  isOwner?: boolean;
  /** 商业化闭环批次:仅 isOwner=true 时回传项目 id,owner 直达 /preview/:id 解锁;访客不泄露归属 */
  projectId?: string;
}

/** 复制分享为新项目的结果（前端契约）：复制成功后直达编辑器 */
export interface ShareDuplicateResult {
  projectId: string;
  projectName: string;
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
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    // 模板使用统计批次：社区模板热度计数（view/copy 原子自增；仅按 token 命中，旁路）
    @InjectRepository(CommunityTemplateEntity)
    private readonly communityRepo: Repository<CommunityTemplateEntity>,
    // 投稿激励批次：复制里程碑领取记录
    @InjectRepository(TemplateCopyRewardEntity)
    private readonly copyRewardRepo: Repository<TemplateCopyRewardEntity>,
    // 投稿激励批次：会员天数发放统一入口（经 BillingModule 导出，无循环依赖）
    private readonly billingService: BillingService,
    /* 商业化闭环批次:可选 JWT 校验(识别分享页访客是否为项目归属人),经 AuthModule 导出的 jwtModule 注入 */
    private readonly jwtService: JwtService,
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
   * 快赢批次一(QW1):成功路径记 share_view 事件(仅 projectId + token,不带任何用户身份),
   * 使「分享页浏览 → CTA 点击 → 注册」漏斗中段可测;404 路径不记(防刷日志)。
   * 商业化闭环批次:可选 Bearer token —— 令牌合法且为项目归属人时回传
   * isOwner + projectId（owner 直达解锁动线）；解锁态升级为
   * 「项目已付费 || 归属人会员在期」（全站免水印）。无效/过期令牌一律按访客处理，
   * 不回传任何归属字段（访客视角与旧版完全一致，不泄露归属信息）。
   */
  async viewShare(token: string, bearer?: string | null): Promise<ShareView> {
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
      select: ['id', 'project_name', 'unlocked', 'userId'],
      where: { id: share.projectId },
    });

    // 可选鉴权：令牌验证失败/用户不存在 → 安静降级为访客（不影响公开读取主链路）
    let viewerUserId: string | null = null;
    if (bearer) {
      try {
        const payload = await this.jwtService.verifyAsync(bearer);
        const user = await this.userRepository.findOne({
          where: { id: String(payload?.id ?? '') },
          select: ['id'],
        });
        if (user) viewerUserId = String(user.id);
      } catch {
        // 无效令牌按访客处理：分享页是公开页，鉴权失败不应 401
      }
    }

    // 模板使用统计（template-usage-stats-batch）：该 token 属于社区模板 → 查看数 +1。
    // 旁路：失败只告警；普通分享 token 无命中行零成本。
    this.trackCommunityUsage('view_count', token);

    // 解锁态：项目已付费 || 归属人会员在期（owner 全站去水印权益）
    let unlocked = project?.unlocked === true;
    if (!unlocked && project?.userId) {
      const owner = await this.userRepository.findOne({
        where: { id: String(project.userId) },
        select: ['id', 'vipExpireTime'],
      });
      unlocked = isVipActive(owner?.vipExpireTime);
    }
    const isOwner =
      viewerUserId != null &&
      project?.userId != null &&
      String(project.userId) === viewerUserId;

    this.growthEvent.track('share_view', {
      projectId: share.projectId,
      token,
    });

    return {
      projectName: project?.project_name ?? '分享的流程图',
      editorData: Array.isArray(doc.editorData) ? doc.editorData : [],
      unlocked,
      ...(isOwner ? { isOwner: true, projectId: String(share.projectId) } : {}),
    };
  }

  /**
   * 复制分享为我的项目（快赢批次一 QW2,Figma Duplicate 式转化钩子）：
   * 凭公开 token 读画布 → 复制为新项目(归属当前登录用户,解锁态不继承)。
   * 「想要这个文件」是最强注册意图信号 —— 该端点需 JWT,未登录访客由前端引导注册。
   * 重名处理:「原名 · 副本」起,冲突则追加序号(≤5 次),仍冲突退化为随机后缀;
   * project_name 列宽 50,基名超长先截断。
   */
  async duplicateShare(
    token: string,
    userId: string | null | undefined,
  ): Promise<ShareDuplicateResult> {
    // 复用公开读取链做 token 校验(404 语义一致);失败直接抛出
    const view = await this.viewShare(token);

    // 重名探测:「原名 · 副本」起,冲突追加序号(≤5 轮),五连撞退化为随机后缀保证必成功;
    // project_name 列宽 50,基名超长先截断
    const baseName = (view.projectName || '分享的流程图').slice(0, 40);
    let newName = `${baseName} · 副本`;
    let nameFree =
      (await this.projectRepository.findOne({ where: { project_name: newName } })) == null;
    for (let attempt = 2; attempt <= 5 && !nameFree; attempt++) {
      newName = `${baseName} · 副本${attempt}`;
      nameFree =
        (await this.projectRepository.findOne({ where: { project_name: newName } })) == null;
    }
    if (!nameFree) {
      newName = `${baseName} · ${randomBytes(2).toString('hex')}`;
    }

    const savedProject = await this.projectRepository.save(
      this.projectRepository.create({
        project_name: newName.slice(0, 50),
        project_desc: '',
        userId: userId ? String(userId) : null,
        // 解锁态不继承:复制件按新项目计(免费档水印),避免解锁态被复制套利
        unlocked: false,
      } as Partial<ProjectEntity>),
    );

    // 画布内容随项目复制(editor_document 按 projectId 关联,直接新插一行)
    await this.editorDocumentRepository.save(
      this.editorDocumentRepository.create({
        projectId: String(savedProject.id),
        projectName: newName,
        editorData: view.editorData,
      } as Partial<EditorDocumentEntity>),
    );

    // 转化信号:分享被复制 = 最强注册/留存意图,单独记事件衡量分享页质量
    this.growthEvent.track('share_duplicate', {
      userId: userId ? String(userId) : null,
      projectId: String(savedProject.id),
    });
    // 模板使用统计（template-usage-stats-batch）：该 token 属于社区模板 → 复制数 +1，
    // 并按复制里程碑跨档自动送投稿人会员天数（投稿激励批次，旁路）
    this.trackCommunityCopy(token);

    return { projectId: String(savedProject.id), projectName: newName };
  }

  /**
   * 模板使用计数（旁路，template-usage-stats-batch）：
   * token 命中社区模板时原子自增对应列（view_count）；
   * 普通分享 token 无命中行零成本；失败静默 —— 统计绝不阻断查看主链路。
   */
  private trackCommunityUsage(column: 'view_count', token: string): void {
    this.communityRepo
      .query(`UPDATE community_template SET ${column} = ${column} + 1 WHERE share_token = $1`, [
        String(token),
      ])
      .catch(() => undefined);
  }

  /**
   * 复制计数 + 里程碑激励（旁路，投稿激励批次）：
   * copy_count 原子自增并 RETURNING 读回当前值与投稿人 → 跨档
   * （被复制 5 次/20 次）且未领取过 → INSERT ON CONFLICT DO NOTHING 抢占 →
   * grantVipDays 一次性送投稿人会员天数。失败静默，绝不影响复制主链路。
   */
  private trackCommunityCopy(token: string): void {
    this.communityRepo
      .query(
        `UPDATE community_template SET copy_count = copy_count + 1
         WHERE share_token = $1
         RETURNING copy_count, owner_id`,
        [String(token)],
      )
      .then(async (rows: Array<{ copy_count: number; owner_id: string }>) => {
        if (!Array.isArray(rows) || rows.length === 0) return;
        const copyCount = Number(rows[0].copy_count) || 0;
        const ownerId = String(rows[0].owner_id ?? '');
        if (!ownerId || copyCount <= 0) return;
        await this.grantCommunityCopyMilestones(ownerId, copyCount);
      })
      .catch(() => undefined);
  }

  /** 复制里程碑发放：先守卫达标，再抢占领取记录（防并发重复），发放走 grantVipDays */
  private async grantCommunityCopyMilestones(ownerId: string, copyCount: number): Promise<void> {
    for (const milestone of COMMUNITY_COPY_MILESTONES) {
      if (copyCount < milestone.count) break;
      try {
        const claimed: Array<unknown> = await this.copyRewardRepo.query(
          `INSERT INTO template_copy_reward (user_id, milestone, reward_days, create_time)
           VALUES ($1, $2, $3, NOW())
           ON CONFLICT (user_id, milestone) DO NOTHING
           RETURNING milestone`,
          [ownerId, milestone.count, milestone.days],
        );
        if (Array.isArray(claimed) && claimed.length > 0) {
          await this.billingService.grantVipDays(ownerId, milestone.days, 'community_copy_milestone');
        }
      } catch (err) {
        // 单档失败不影响其余档位与复制主链路
        console.warn(
          `[CommunityReward] 复制里程碑发放失败(旁路): owner=${ownerId} milestone=${milestone.count}`,
          (err as Error)?.message ?? err,
        );
      }
    }
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
