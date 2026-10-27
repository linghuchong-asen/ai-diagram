// 语图技术方案 - 多形态产物 Schema 单测(multi-artifact-batch Round 2)
// 覆盖四条关键路径:
//   ① 四种新形态(mindmap/table/checklist/timeline)合法样例通过、非法样例(缺字段/超界/行列不齐)被拒;
//   ② generate 响应体的形态-payload 配对契约(artifactKind 与对应 Draft 必须同时出现);
//   ③ 向后兼容:无 artifactKind 的旧响应(仅 flowDraft)依然合法;
//   ④ formHint 白名单:合法枚举通过、非法值被拒。
import {
  MindMapDraftSchema,
  TableDraftSchema,
  ChecklistDraftSchema,
  TimelineDraftSchema,
  ARTIFACT_KINDS,
  artifactSchemaFor,
  ARTIFACT_PAYLOAD_FIELD,
  MindMapNode,
} from './artifact.schema';
import { GenerateResultSchema, ChatRequestSchema, TrialChatRequestSchema } from './chat.schema';

/** 合法思维导图样例:3 层、总节点 7 个 */
function sampleMindmap() {
  return {
    root: {
      id: 'm1',
      label: '项目周会',
      children: [
        {
          id: 'm2',
          label: '上周进展',
          children: [
            { id: 'm4', label: '登录模块完成', children: [] },
            { id: 'm5', label: '支付联调中', children: [] },
          ],
        },
        {
          id: 'm3',
          label: '本周计划',
          children: [
            { id: 'm6', label: '压测', children: [] },
            { id: 'm7', label: '灰度发布', children: [] },
          ],
        },
      ],
    },
  };
}

/** 合法对比表格样例:3 列 × 3 行 + 结论 */
function sampleTable() {
  return {
    columns: ['维度', '方案A 自建', '方案B 采购'],
    rows: [
      ['成本', '人力 3 人月', '年费 12 万'],
      ['工期', '3 个月', '2 周上线'],
      ['维护', '自主可控', '依赖厂商'],
    ],
    conclusion: '工期紧张时推荐方案B,长期看自建成本更优。',
  };
}

/** 合法清单样例:2 组共 5 项,含 owner/due */
function sampleChecklist() {
  return {
    groups: [
      {
        title: '上线前检查',
        items: [
          { text: '回归测试全绿', owner: '测试组', due: '周三前' },
          { text: '数据库备份', owner: '运维' },
          { text: '回滚预案确认' },
        ],
      },
      {
        title: '上线后动作',
        items: [{ text: '观察监控大盘 1 小时', owner: '值班' }, { text: '群公告通知' }],
      },
    ],
  };
}

/** 合法时间线样例:3 个事件 */
function sampleTimeline() {
  return {
    events: [
      { time: 'Day1 上午', title: '抵达成都', detail: '高铁 G8511,酒店寄存行李' },
      { time: 'Day1 下午', title: '武侯祠 + 锦里' },
      { time: 'Day1 晚上', title: '火锅(蜀九香)' },
    ],
  };
}

/** 旧版 generate 响应(无 artifactKind,仅 flowDraft)——向后兼容基线 */
function legacyGenerateResult() {
  return {
    kind: 'generate' as const,
    flowDraft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '处理', type: 'process' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    },
  };
}

describe('多形态产物 Schema(multi-artifact-batch Round 2)', () => {
  // ---- ① 四形态合法/非法 ----
  it('① mindmap:合法 3 层树通过;缺 label / 子项超 8 被拒', () => {
    expect(MindMapDraftSchema.safeParse(sampleMindmap()).success).toBe(true);

    // 缺 label
    const noLabel = { root: { id: 'm1', children: [] } };
    expect(MindMapDraftSchema.safeParse(noLabel).success).toBe(false);

    // 单节点子项 > 8
    const tooWide: MindMapNode = {
      id: 'm1',
      label: '根',
      children: Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, label: `子${i}`, children: [] })),
    };
    const wide = MindMapDraftSchema.safeParse({ root: tooWide });
    expect(wide.success).toBe(false);

    // children 缺省时由 default([]) 补齐(模型偶尔漏写叶子节点 children 是合法容忍范围)
    const noChildrenField = MindMapDraftSchema.parse({ root: { id: 'm1', label: '根' } });
    expect(noChildrenField.root.children).toEqual([]);
  });

  it('① table:合法表格通过;行列不齐 / 单列 / 单行被拒', () => {
    expect(TableDraftSchema.safeParse(sampleTable()).success).toBe(true);

    // 行长度与列数不一致 → 格式层直接拒绝(渲染层无法画出行列不齐的表)
    const ragged = { ...sampleTable(), rows: [['成本', '3 人月']] };
    const raggedParsed = TableDraftSchema.safeParse(ragged);
    expect(raggedParsed.success).toBe(false);
    if (!raggedParsed.success) {
      expect(raggedParsed.error.issues.some((i) => i.message.includes('列数一致'))).toBe(true);
    }

    // 单列被拒
    expect(TableDraftSchema.safeParse({ columns: ['只有一列'], rows: [['a'], ['b']] }).success).toBe(false);
    // 单行被拒
    expect(TableDraftSchema.safeParse({ columns: ['a', 'b'], rows: [['1', '2']] }).success).toBe(false);
  });

  it('① checklist:合法清单通过;空分组 / 空项内容被拒', () => {
    expect(ChecklistDraftSchema.safeParse(sampleChecklist()).success).toBe(true);

    // 分组无任何项
    const emptyGroup = { groups: [{ title: '空组', items: [] }] };
    expect(ChecklistDraftSchema.safeParse(emptyGroup).success).toBe(false);
    // 项内容为空字符串
    const blankItem = { groups: [{ title: '组', items: [{ text: '' }] }] };
    expect(ChecklistDraftSchema.safeParse(blankItem).success).toBe(false);
    // owner/due 为可选:仅 text 的项合法
    expect(ChecklistDraftSchema.safeParse({ groups: [{ title: '组', items: [{ text: '只做一件事' }] }] }).success).toBe(true);
  });

  it('① timeline:合法时间线通过;单事件 / 缺时间标记被拒', () => {
    expect(TimelineDraftSchema.safeParse(sampleTimeline()).success).toBe(true);

    expect(TimelineDraftSchema.safeParse({ events: [{ time: 'Day1', title: '唯一事件' }] }).success).toBe(false);
    const noTime = { events: [{ title: '缺时间' }, { time: 'Day2', title: '第二件事' }] };
    expect(TimelineDraftSchema.safeParse(noTime).success).toBe(false);
  });

  // ---- ② 形态-payload 配对契约 ----
  it('② generate 响应:table 形态必须携带 tableDraft,缺配对字段被拒', () => {
    const ok = GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'table', tableDraft: sampleTable() });
    expect(ok.success).toBe(true);

    const missing = GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'table' });
    expect(missing.success).toBe(false);
    if (!missing.success) {
      expect(missing.error.issues.some((i) => i.message.includes('tableDraft'))).toBe(true);
    }
  });

  it('② generate 响应:mindmap/checklist/timeline 形态配对通过', () => {
    expect(
      GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'mindmap', mindmapDraft: sampleMindmap() }).success,
    ).toBe(true);
    expect(
      GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'checklist', checklistDraft: sampleChecklist() }).success,
    ).toBe(true);
    expect(
      GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'timeline', timelineDraft: sampleTimeline() }).success,
    ).toBe(true);
  });

  it('② generate 响应:显式 flowchart 但缺 flowDraft 被拒', () => {
    const bad = GenerateResultSchema.safeParse({ kind: 'generate', artifactKind: 'flowchart' });
    expect(bad.success).toBe(false);
  });

  // ---- ③ 向后兼容 ----
  it('③ 旧版响应(无 artifactKind,仅 flowDraft)依然合法', () => {
    const legacy = GenerateResultSchema.safeParse(legacyGenerateResult());
    expect(legacy.success).toBe(true);
  });

  // ---- ④ formHint 白名单 ----
  it('④ ChatRequest.formHint:五种合法枚举通过,非法值被拒', () => {
    for (const kind of ARTIFACT_KINDS) {
      const parsed = ChatRequestSchema.safeParse({ message: 'x', formHint: kind });
      expect(parsed.success).toBe(true);
    }
    expect(ChatRequestSchema.safeParse({ message: 'x', formHint: 'ppt' }).success).toBe(false);
    // 不带 formHint(旧行为)合法
    expect(ChatRequestSchema.safeParse({ message: 'x' }).success).toBe(true);
  });

  it('④ TrialChatRequest.formHint:与登录链路同构', () => {
    expect(TrialChatRequestSchema.safeParse({ message: 'x', trialId: 't1', formHint: 'timeline' }).success).toBe(true);
    expect(TrialChatRequestSchema.safeParse({ message: 'x', trialId: 't1', formHint: 'unknown' }).success).toBe(false);
  });

  // ---- 辅助映射的完整性(供 graph 组装/还原复用) ----
  it('辅助映射:五形态的 payload 字段名与 Schema 选择器一一对应', () => {
    expect(ARTIFACT_PAYLOAD_FIELD.flowchart).toBe('flowDraft');
    expect(ARTIFACT_PAYLOAD_FIELD.mindmap).toBe('mindmapDraft');
    expect(ARTIFACT_PAYLOAD_FIELD.table).toBe('tableDraft');
    expect(ARTIFACT_PAYLOAD_FIELD.checklist).toBe('checklistDraft');
    expect(ARTIFACT_PAYLOAD_FIELD.timeline).toBe('timelineDraft');

    // flowchart 走既有 FlowDraftSchema,选择器返回 null;其余四形态返回对应 Schema
    expect(artifactSchemaFor('flowchart')).toBeNull();
    expect(artifactSchemaFor('mindmap')).toBe(MindMapDraftSchema);
    expect(artifactSchemaFor('table')).toBe(TableDraftSchema);
    expect(artifactSchemaFor('checklist')).toBe(ChecklistDraftSchema);
    expect(artifactSchemaFor('timeline')).toBe(TimelineDraftSchema);
  });
});
