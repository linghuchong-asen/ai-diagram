// 语图 Task 7 - 模板中心服务
// 设计要点：
//   - 高频模板静态预置（硬编码数组），无表无迁移零成本；
//   - prompt 是可直接喂 AI 的完整流程描述（含节点与分支线索），
//     前端点击模板后拼 /trial?q= 跳转试用页自动发送；
//   - description 是给用户看的一句话场景说明，scene 是短标签。
// Round C（2026-10-26）场景扩充 12 → 16：会议纪要→泳道图、PRD→用户流程图、
//   论文技术路线图、年终述职一图流 —— 分别是 B6/B7/B1/A6 的 prompt 级先导
//   （对应《魔性传播与商业化功能战略》B 层场景纵深的低成本落地）。
// competitor-driven-evolution-batch Round 18：新增「多形态」分类 16 → 20 ——
//   四条新形态模板携带 formHint（前端点击后拼 /trial?q=...&form=table 直达形态，
//   FormRouter formHint 直通,不再赌关键词路由）。formHint 取值与 ai/schemas/artifact.schema
//   的 ArtifactKind 白名单对齐(此处用字符串联合避免跨模块依赖)。
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { HttpException, HttpStatus } from '@nestjs/common';
import { CommunityTemplateEntity } from './entities/community-template.entity';
import { ProjectEntity } from '../projectManager/entities/project_manager.entity';
import { ProjectShareEntity } from '../projectShare/entities/project_share.entity';
import { customLogger } from '../../utils/log/logger.service';

/** 模板分类（与前端过滤 chips 一一对应） */
export type TemplateCategory = '校园' | '职场' | '电商' | '研发' | '多形态';

/** 分类合法枚举（spec 校验用） */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  '校园',
  '职场',
  '电商',
  '研发',
  '多形态',
];

/** 多形态模板可携带的产物形态提示（与后端 ArtifactKind 新形态白名单一致;flowchart 是缺省不需要） */
export type TemplateFormHint = 'mindmap' | 'table' | 'checklist' | 'timeline';

/** 模板条目（前端契约）：prompt 可直接作为 AI 生成指令 */
export interface FlowTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** 短标签（如「论文答辩」） */
  scene: string;
  /** 一句话场景说明（给用户看） */
  description: string;
  /** 可直接喂 AI 的完整流程描述（30~60 字，含节点与分支线索） */
  prompt: string;
  /** 产物形态提示（Round 18,仅「多形态」分类模板携带;前端拼 &form= 透传给 /trial） */
  formHint?: TemplateFormHint;
}

/** 预置模板清单（顺序即前端展示顺序） */
const FLOW_TEMPLATES: FlowTemplate[] = [
  {
    id: 'campus-thesis-defense',
    name: '毕设答辩流程',
    category: '校园',
    scene: '论文答辩',
    description: '从论文查重、导师审核到现场答辩评分的完整链路',
    prompt:
      '毕设答辩流程：学生提交论文并查重，查重通过后申请答辩，导师审核，通过则安排现场答辩并评分，未通过则修改论文后重新提交查重',
  },
  {
    id: 'campus-algo-learning',
    name: '课程作业-算法学习路径',
    category: '校园',
    scene: '学习规划',
    description: '算法课程从数据结构入门到结课项目的学习路径图',
    prompt:
      '算法学习路径：从数组链表等基础数据结构入门，依次学习栈队列、树与图，每阶段完成练习并通过测验，未通过则复习重练，全部通过后进入结课项目',
  },
  {
    id: 'work-leave-approval',
    name: '请假审批流程',
    category: '职场',
    scene: '行政审批',
    description: '员工请假从提交申请到人事备案的审批链路',
    prompt:
      '请假审批流程：员工提交请假申请，直属主管审批，超过 3 天需部门经理复核，通过后人事备案并通知员工，驳回则填写原因退回修改',
  },
  {
    id: 'work-expense-reimburse',
    name: '费用报销审批流程',
    category: '职场',
    scene: '财务审批',
    description: '差旅与日常费用报销的审批与打款链路',
    prompt:
      '费用报销流程：员工上传发票提交报销，主管审批后财务审核票据，金额超限需总监审批，通过后财务打款并通知员工，驳回则退回补充材料',
  },
  {
    id: 'work-meeting-room',
    name: '会议室预约流程',
    category: '职场',
    scene: '行政办公',
    description: '会议室查询、预约、签到到自动释放的闭环',
    prompt:
      '会议室预约流程：查询目标时段是否空闲，提交预约申请，管理员确认，时段冲突则改约其他时间，预约成功后参会人签到，会议结束自动释放会议室',
  },
  {
    id: 'work-onboarding',
    name: '新员工入职流程',
    category: '职场',
    scene: 'HR 管理',
    description: 'offer 确认、手续办理、培训考核到转正评审全链路',
    prompt:
      '新员工入职流程：发放 offer 并确认入职日期，入职当天办理手续并领取设备，参加入职培训并通过考核，试用期结束进行转正评审，通过则正式转正',
  },
  {
    id: 'ecom-refund',
    name: '电商订单退款流程',
    category: '电商',
    scene: '售后处理',
    description: '买家申请退款、商家审核到平台介入的完整链路',
    prompt:
      '电商订单退款：用户提交退款申请，商家审核，通过则原路退回并通知用户，拒绝则进入协商，协商不成可申请平台介入',
  },
  {
    id: 'ecom-group-buy',
    name: '电商拼团流程',
    category: '电商',
    scene: '营销玩法',
    description: '拼团发起、好友参团到成团发货或退款的两条分支',
    prompt:
      '电商拼团流程：用户发起拼团并完成支付，分享链接邀请好友参团，人数达标则成团并安排发货，超时未成团则系统自动原路退款',
  },
  {
    id: 'dev-auth-flow',
    name: '用户注册登录流程',
    category: '研发',
    scene: '账号体系',
    description: '注册验证、登录校验与密码找回的标准链路',
    prompt:
      '用户注册登录流程：新用户手机号注册并验证短信验证码，设置密码完成注册，登录时校验账号密码，错误超限则临时锁定，忘记密码可经短信验证重置',
  },
  {
    id: 'dev-deploy-release',
    name: '项目部署上线流程',
    category: '研发',
    scene: '工程效率',
    description: '代码评审、CI 构建到灰度发布或回滚的 CI/CD 链路',
    prompt:
      '项目部署上线流程：开发者提交合并请求，代码评审通过后触发 CI 构建与自动化测试，测试通过则灰度发布，灰度验证正常后全量上线，异常则立即回滚',
  },
  {
    id: 'dev-requirement-review',
    name: '需求评审流程',
    category: '研发',
    scene: '研发管理',
    description: '需求提交、评审会讨论到排期开发或退回修改的链路',
    prompt:
      '需求评审流程：产品经理提交需求文档，组织评审会，技术评估可行性与工作量，通过则排期进入开发，材料不足则退回产品补充后重新评审',
  },
  {
    id: 'dev-content-moderation',
    name: '内容发布审核流程',
    category: '研发',
    scene: '平台治理',
    description: 'UGC 内容机审、人审到上架或申诉的审核链路',
    prompt:
      '内容发布审核流程：用户提交内容，机器审核过滤违规文本与图片，机审通过进入人工复审，人审通过则上架展示，违规则驳回并通知用户可申诉',
  },
  {
    id: 'work-meeting-minutes',
    name: '会议纪要转泳道图',
    category: '职场',
    scene: '会议协作',
    description: '把讨论型会议纪要落成按角色分工的泳道流程图',
    prompt:
      '把以下会议纪要整理成按角色分泳道的流程图：产品提出需求变更，前端评估改动范围，后端评估接口与数据影响，测试补充回归用例，全部确认后排入本周迭代，有分歧则升级到技术负责人仲裁：周一需求评审会确定购物车新增优惠券功能，前端周一出交互稿，后端周二出接口设计，测试周三前完成用例评审，周五联调，下周一上线',
  },
  {
    id: 'dev-prd-user-flow',
    name: 'PRD 转用户流程图',
    category: '研发',
    scene: '产品设计',
    description: '把 PRD 段落转成用户操作流程图（含异常分支）',
    prompt:
      '把以下 PRD 描述画成用户流程图：用户在收银台页面可选择支付宝或微信支付，选择后跳转对应支付收银台，支付成功返回商户展示成功页并通知发货，支付失败允许重试最多 3 次，3 次失败后引导更换支付方式，用户中途取消则订单保留 30 分钟待支付，超时自动关闭',
  },
  {
    id: 'campus-thesis-roadmap',
    name: '论文技术路线图',
    category: '校园',
    scene: '毕业论文',
    description: '开题到答辩的学术风技术路线图（研究方法链）',
    prompt:
      '画一张毕业论文技术路线图：确定研究问题后进行文献综述，提出研究假设，设计研究方法（问卷/实验/建模），采集数据并预处理，数据分析与假设检验，结果不显著则修正假设重新实验，显著则撰写论文，导师审阅修改，查重通过后提交答辩',
  },
  {
    id: 'work-year-review',
    name: '年终述职一图流',
    category: '职场',
    scene: '年终汇报',
    description: '把全年工作浓缩成一张述职流程图（目标→动作→结果）',
    prompt:
      '画一张年终述职一图流：年初制定 OKR，Q1 完成基础建设并复盘调整目标，Q2-Q3 主线业务迭代按月交付并做数据回收，目标达成则沉淀方法论，未达成则归因分析，Q4 收口冲刺并盘点成果，最终形成述职报告：亮点、不足、明年规划',
  },
  // ---- competitor-driven-evolution-batch Round 18:多形态模板(formHint 直达,不赌关键词路由) ----
  {
    id: 'multi-tech-selection',
    name: '技术选型对比表',
    category: '多形态',
    scene: '对比表格',
    description: '自建 vs 采购多维度横评，附推荐结论',
    prompt:
      '帮我对比「自建」和「采购」两个方案：从成本、工期、维护性、风险、扩展性几个维度展开，最后给出推荐结论',
    formHint: 'table',
  },
  {
    id: 'multi-meeting-todo',
    name: '会议待办清单',
    category: '多形态',
    scene: '清单',
    description: '把周会内容整理成分组可勾选待办',
    prompt:
      '把项目周会内容整理成分组待办清单：上线前检查（回归测试、数据库备份、回滚预案）、上线后动作（监控观察、群公告）',
    formHint: 'checklist',
  },
  {
    id: 'multi-trip-timeline',
    name: '三天两晚行程时间线',
    category: '多形态',
    scene: '时间线',
    description: '成都三日游按天排布的行程时间线',
    prompt:
      '帮我安排成都三天两晚的行程时间线：第一天武侯祠锦里和火锅，第二天大熊猫基地和宽窄巷子，第三天人民公园和返程',
    formHint: 'timeline',
  },
  {
    id: 'multi-reading-mindmap',
    name: '读书笔记思维导图',
    category: '多形态',
    scene: '思维导图',
    description: '把一本书的知识体系整理成导图',
    prompt:
      '把《红楼梦》的知识体系整理成思维导图：四大家族关系、主要人物、经典情节、主题思想',
    formHint: 'mindmap',
  },
];

@Injectable()
export class TemplateService {
  constructor(
    // 社区模板批次：投稿/列表/审核（官方预置模板仍为纯静态，零成本不变）
    @InjectRepository(CommunityTemplateEntity)
    private readonly communityRepo: Repository<CommunityTemplateEntity>,
    @InjectRepository(ProjectEntity)
    private readonly projectRepository: Repository<ProjectEntity>,
    @InjectRepository(ProjectShareEntity)
    private readonly shareRepository: Repository<ProjectShareEntity>,
  ) {}

  /** 返回全部预置模板（静态数据，每次返回同一引用即可，调用方只读） */
  listTemplates(): FlowTemplate[] {
    return FLOW_TEMPLATES;
  }

  /**
   * 社区模板投稿（需登录 + 归属校验，社区模板批次）：
   *   - 项目不存在/非本人 → 404 防枚举；
   *   - 同项目重复投稿 → 400（projectId 唯一；驳回后可联系运营删记录重投）；
   *   - 自动确保成品可看：查 project_share 复用既有 token，无则直建——
   *     刻意不走 ProjectShareService.createShare（其首次创建会发放分享奖励额度，
   *     投稿触发奖励 = 套利漏洞），也不记 share_create 事件；
   *   - status=pending 待审（UGC 必审后上架），记 community_submit 增长事件。
   */
  async submitCommunity(
    userId: string | null | undefined,
    projectId: string,
    description?: string,
    ownerName?: string,
  ): Promise<CommunityTemplateEntity> {
    const project = await this.projectRepository.findOne({
      where: { id: projectId },
    });
    if (!project || String(project.userId ?? '') !== String(userId ?? '')) {
      throw new HttpException('项目不存在', HttpStatus.NOT_FOUND);
    }
    const existed = await this.communityRepo.findOne({
      where: { projectId: String(project.id ?? projectId) },
    });
    if (existed) {
      throw new HttpException('该项目已投稿，请等待审核结果', HttpStatus.BAD_REQUEST);
    }

    // 分享 token：复用既有分享；无则直建（不发奖励、不记 share_create）
    let share = await this.shareRepository.findOne({
      where: { projectId: String(project.id ?? projectId) },
    });
    if (!share) {
      share = await this.shareRepository.save(
        this.shareRepository.create({
          shareToken: randomBytes(16).toString('hex'),
          projectId: String(project.id ?? projectId),
          userId: String(userId ?? ''),
        }),
      );
    }

    const title = String(project.project_name ?? '社区模板').slice(0, 50);
    const saved = await this.communityRepo.save(
      this.communityRepo.create({
        projectId: String(project.id ?? projectId),
        ownerId: String(userId ?? ''),
        // 署名快照：投稿时昵称（JWT 侧传入），空则匿名展示「图友」
        ownerName: String(ownerName ?? '').trim().slice(0, 50) || '图友',
        title,
        description: String(description ?? '').slice(0, 120),
        shareToken: share.shareToken,
        status: 'pending',
      }),
    );
    customLogger.log(
      `GROWTH_EVENT ${JSON.stringify({
        event: 'community_submit',
        ts: new Date().toISOString(),
        userId: String(userId ?? ''),
        projectId: String(project.id ?? projectId),
        templateId: saved.id,
      })}`,
      'TemplateService',
    );
    return saved;
  }

  /**
   * 社区精选列表（公开）：仅已上架，≤24 条。
   * 排序（模板使用统计批次）：复制数降序 → 时间降序（热门优先）；
   * 返回 viewCount/copyCount 供热度和未来投稿激励使用。
   */
  async listCommunity(): Promise<
    Array<{
      id: string;
      title: string;
      description: string;
      ownerName: string;
      shareToken: string;
      viewCount: number;
      copyCount: number;
    }>
  > {
    const rows = await this.communityRepo.find({
      where: { status: 'approved' },
      order: { copyCount: 'DESC', createTime: 'DESC' },
      take: 24,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      description: r.description,
      ownerName: r.ownerName,
      shareToken: r.shareToken,
      viewCount: Number(r.viewCount) || 0,
      copyCount: Number(r.copyCount) || 0,
    }));
  }

  /** 待审列表（仅 root）：先投先审 */
  async listCommunityPending(): Promise<CommunityTemplateEntity[]> {
    return this.communityRepo.find({
      where: { status: 'pending' },
      order: { createTime: 'ASC' },
      take: 50,
    });
  }

  /**
   * 我的社区作品（需登录，投稿者数据面板）：本人全部投稿 + 审核状态 + 热度。
   * 投稿激励的反馈闭环：投稿者能看到「审核中/已上架/已驳回」与作品热度。
   */
  async listMyCommunity(userId: string | null | undefined): Promise<
    Array<{
      id: string;
      title: string;
      status: string;
      viewCount: number;
      copyCount: number;
      shareToken: string;
    }>
  > {
    const rows = await this.communityRepo.find({
      where: { ownerId: String(userId ?? '') },
      order: { createTime: 'DESC' },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      title: r.title,
      status: r.status,
      viewCount: Number(r.viewCount) || 0,
      copyCount: Number(r.copyCount) || 0,
      shareToken: r.shareToken,
    }));
  }

  /**
   * 审核（仅 root）：approve → 上架；reject → 驳回。记录不存在或非待审 → 404。
   */
  async reviewCommunity(
    templateId: string,
    approve: boolean,
  ): Promise<CommunityTemplateEntity> {
    const row = await this.communityRepo.findOne({ where: { id: templateId } });
    if (!row || row.status !== 'pending') {
      throw new HttpException('投稿不存在或已处理', HttpStatus.NOT_FOUND);
    }
    row.status = approve ? 'approved' : 'rejected';
    return this.communityRepo.save(row);
  }
}
