// 语图 Task 7 - 模板中心服务
// 设计要点：
//   - 12 个高频模板静态预置（硬编码数组），无表无迁移零成本；
//   - prompt 是可直接喂 AI 的完整流程描述（含节点与分支线索），
//     前端点击模板后拼 /trial?q= 跳转试用页自动发送；
//   - description 是给用户看的一句话场景说明，scene 是短标签。
import { Injectable } from '@nestjs/common';

/** 模板分类（与前端过滤 chips 一一对应） */
export type TemplateCategory = '校园' | '职场' | '电商' | '研发';

/** 分类合法枚举（spec 校验用） */
export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  '校园',
  '职场',
  '电商',
  '研发',
];

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
];

@Injectable()
export class TemplateService {
  /** 返回全部预置模板（静态数据，每次返回同一引用即可，调用方只读） */
  listTemplates(): FlowTemplate[] {
    return FLOW_TEMPLATES;
  }
}
