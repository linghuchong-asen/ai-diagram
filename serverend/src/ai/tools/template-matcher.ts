// 语图技术方案 - 内置 Skill:TemplateMatcher
// 文档:统一抽象为提示词工程 + 适配层(RAG/Function Call/Skill/MCP);
// 内置 Skill 为 TemplateMatcher(模板匹配:命中模板直接返回,有定制需求则跳过)。
import { Injectable } from '@nestjs/common';
import { FlowDraft } from '../schemas/flow-draft.schema';

export interface FlowTemplate {
  id: string;
  name: string;
  keywords: string[];
  draft: FlowDraft;
}

// 内置模板库(可扩展)
const BUILTIN_TEMPLATES: FlowTemplate[] = [
  {
    id: 'leave-approval',
    name: '请假审批流程',
    keywords: ['请假', '请假审批', '请假流程', '休假'],
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '提交请假申请', type: 'process' },
        { id: 'n3', label: '直属领导审批', type: 'process' },
        { id: 'n4', label: '审批通过?', type: 'decision' },
        { id: 'n5', label: '人事备案', type: 'process' },
        { id: 'n6', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
        { id: 'e4', source: 'n4', target: 'n5', label: '是' },
        { id: 'e5', source: 'n4', target: 'n2', label: '否' },
        { id: 'e6', source: 'n5', target: 'n6' },
      ],
    },
  },
  {
    id: 'expense-reimbursement',
    name: '费用报销流程',
    keywords: ['报销', '费用报销', '报销流程'],
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '填写报销单', type: 'process' },
        { id: 'n3', label: '部门经理审批', type: 'process' },
        { id: 'n4', label: '财务审核', type: 'process' },
        { id: 'n5', label: '审核通过?', type: 'decision' },
        { id: 'n6', label: '打款', type: 'process' },
        { id: 'n7', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n4' },
        { id: 'e4', source: 'n4', target: 'n5' },
        { id: 'e5', source: 'n5', target: 'n6', label: '通过' },
        { id: 'e6', source: 'n5', target: 'n4', label: '不通过' },
        { id: 'e7', source: 'n6', target: 'n7' },
      ],
    },
  },
];

export interface TemplateMatchResult {
  matched: boolean;
  template?: FlowTemplate;
}

@Injectable()
export class TemplateMatcher {
  /** 判断用户请求是否命中内置模板 */
  match(query: string): TemplateMatchResult {
    const q = query.toLowerCase();
    // 有定制化需求(修改词/数量词/具体节点)则不命中模板
    const customizationHints = ['修改', '加上', '去掉', '增加', '删除', '改', '包含', '自定义', '要', '不要'];
    const hasCustomization = customizationHints.some((h) => q.includes(h));

    for (const t of BUILTIN_TEMPLATES) {
      const hitKeywords = t.keywords.filter((k) => q.includes(k));
      if (hitKeywords.length > 0 && !hasCustomization) {
        return { matched: true, template: t };
      }
    }
    return { matched: false };
  }
}
