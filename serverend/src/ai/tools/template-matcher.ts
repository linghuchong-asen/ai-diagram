// 语图技术方案 - 内置 Skill:TemplateMatcher
// 文档:统一抽象为提示词工程 + 适配层(RAG/Function Call/Skill/MCP);
// 内置 Skill 为 TemplateMatcher(模板匹配:命中模板直接返回,有定制需求则跳过)。
// competitor-driven-evolution-batch Round 13:模板库从「仅流程图」扩展到全形态——
//   四种新形态(mindmap/table/checklist/timeline)各内置高频模板(对标 Mermaid Chart 的
//   snippet 生态:常见请求秒回且零 token)。match 增第二参 artifactKind 按形态分库;
//   flowchart 语义不变(命中返回 FlowDraft,定制词仍跳过)。
import { Injectable } from '@nestjs/common';
import { FlowDraft } from '../schemas/flow-draft.schema';
import type { ArtifactKind } from '../schemas/artifact.schema';

export interface FlowTemplate {
  id: string;
  name: string;
  keywords: string[];
  draft: FlowDraft;
}

/** 非 flowchart 形态的内置模板(draft 为对应形态的产物本体,结构由各形态 Schema 约束) */
export interface ArtifactTemplate {
  id: string;
  name: string;
  artifactKind: Exclude<ArtifactKind, 'flowchart'>;
  keywords: string[];
  draft: unknown;
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

// ---------------------------------------------------------------------------
// competitor-driven-evolution-batch Round 13:四形态内置模板
// 选材原则:竞品调研(R1)中的高频请求——会议待办/技术选型/短途行程/读书笔记,
//   模板内容为「通用骨架」(不含具体用户事实),命中即秒回,定制需求仍交还 LLM。
// ---------------------------------------------------------------------------

const ARTIFACT_TEMPLATES: ArtifactTemplate[] = [
  {
    id: 'meeting-todo-checklist',
    name: '会议待办清单',
    artifactKind: 'checklist',
    keywords: ['会议待办', '会议清单', '周会待办', '会议纪要清单', '待办清单模板', '上线检查清单'],
    draft: {
      groups: [
        {
          title: '会前准备',
          items: [
            { text: '确认议程与参会人', owner: '主持人' },
            { text: '共享文档与材料提前发出' },
          ],
        },
        {
          title: '待办事项',
          items: [
            { text: '回归测试全量通过', owner: '测试', due: '本周五' },
            { text: '数据库备份完成', owner: '运维', due: '本周五' },
            { text: '回滚预案就绪并演练', owner: '运维' },
          ],
        },
        {
          title: '会后跟进',
          items: [
            { text: '会议纪要与待办同步到群', owner: '记录人', due: '当天' },
            { text: '监控观察 30 分钟', owner: '值班', due: '上线时' },
          ],
        },
      ],
    },
  },
  {
    id: 'tech-selection-table',
    name: '技术选型对比',
    artifactKind: 'table',
    keywords: ['技术选型', '选型对比', '方案对比', '自建还是采购', '自建还是外购', '技术对比'],
    draft: {
      columns: ['维度', '自建', '采购'],
      rows: [
        ['成本', '一次性投入 3 人月', '年费约 12 万'],
        ['工期', '约 3 个月', '约 2 周上线'],
        ['维护性', '需专人长期维护', '厂商保障与升级'],
        ['风险', '人员流失断档', '供应商锁定'],
        ['扩展性', '按需定制', '受产品边界限制'],
      ],
      conclusion: '工期紧张或团队人力不足时推荐采购,长期核心能力建设推荐自建',
    },
  },
  {
    id: 'short-trip-timeline',
    name: '三天两晚行程',
    artifactKind: 'timeline',
    keywords: ['三天两晚', '行程时间线', '旅行计划', '行程安排', '旅游行程', '两日游'],
    draft: {
      events: [
        { time: 'Day1 上午', title: '抵达并入住酒店', detail: '放好行李后轻装出行' },
        { time: 'Day1 下午', title: '城市地标游览', detail: '预留 3 小时 + 拍照时间' },
        { time: 'Day1 晚上', title: '本地特色晚餐' },
        { time: 'Day2 上午', title: '景点深度游', detail: '建议早出发避开人流' },
        { time: 'Day2 下午', title: '历史街区漫步' },
        { time: 'Day2 晚上', title: '夜市/演出体验' },
        { time: 'Day3 上午', title: '公园与 brunch', detail: '退房后行李可寄存前台' },
        { time: 'Day3 下午', title: '返程' },
      ],
    },
  },
  {
    id: 'reading-notes-mindmap',
    name: '读书笔记导图',
    artifactKind: 'mindmap',
    keywords: ['读书笔记', '读书导图', '书籍导图', '知识导图', '读书笔记导图'],
    draft: {
      root: {
        id: 'book',
        label: '书名',
        children: [
          {
            id: 'bg',
            label: '背景脉络',
            children: [
              { id: 'bg-era', label: '时代背景', children: [] },
              { id: 'bg-author', label: '作者立场', children: [] },
            ],
          },
          {
            id: 'people',
            label: '核心人物',
            children: [
              { id: 'people-main', label: '主角线', children: [] },
              { id: 'people-rel', label: '关系网', children: [] },
            ],
          },
          {
            id: 'plot',
            label: '经典情节',
            children: [
              { id: 'plot-1', label: '转折点', children: [] },
              { id: 'plot-2', label: '高潮', children: [] },
            ],
          },
          {
            id: 'theme',
            label: '主题思想',
            children: [
              { id: 'theme-core', label: '核心命题', children: [] },
              { id: 'theme-takeaway', label: '我的收获', children: [] },
            ],
          },
        ],
      },
    },
  },
];

export interface TemplateMatchResult {
  matched: boolean;
  /** flowchart 形态命中的模板 */
  template?: FlowTemplate;
  /** 非 flowchart 形态命中的模板(Round 13) */
  artifactTemplate?: ArtifactTemplate;
}

@Injectable()
export class TemplateMatcher {
  /**
   * 判断用户请求是否命中内置模板。
   * artifactKind 缺省 = flowchart(既有语义不变);指定新形态时只在同形态模板库内匹配,
   * 避免「要清单却返回流程图模板」的跨形态误命中。
   */
  match(query: string, artifactKind?: ArtifactKind): TemplateMatchResult {
    const q = query.toLowerCase();
    const kind: ArtifactKind = artifactKind ?? 'flowchart';
    // 有定制化需求(修改词/数量词/具体节点)则不命中模板
    const customizationHints = ['修改', '加上', '去掉', '增加', '删除', '改', '包含', '自定义', '要', '不要'];
    const hasCustomization = customizationHints.some((h) => q.includes(h));

    if (kind === 'flowchart') {
      for (const t of BUILTIN_TEMPLATES) {
        const hitKeywords = t.keywords.filter((k) => q.includes(k));
        if (hitKeywords.length > 0 && !hasCustomization) {
          return { matched: true, template: t };
        }
      }
      return { matched: false };
    }

    for (const t of ARTIFACT_TEMPLATES) {
      if (t.artifactKind !== kind) continue;
      const hitKeywords = t.keywords.filter((k) => q.includes(k));
      if (hitKeywords.length > 0 && !hasCustomization) {
        return { matched: true, artifactTemplate: t };
      }
    }
    return { matched: false };
  }
}
