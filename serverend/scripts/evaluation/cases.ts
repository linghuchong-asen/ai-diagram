/*
 * @Description: 回归评估固定用例集(Task 13.3)
 *
 * 设计原则:
 *   1. 全部为「确定性可判」的期望，不依赖真实大模型输出质量；
 *   2. 覆盖 generate / modify / consult 三类意图 + 边界输入 + 工具调用 + 图结构；
 *   3. 用例数据即回归基线：任何一处跌破阈值，脚本以非 0 退出码阻断。
 */

/* ---------------- 类型 ---------------- */

export type CaseKind = 'intent' | 'schema' | 'template' | 'graph' | 'tool' | 'e2e';

export interface BaseCase {
  id: string;
  kind: CaseKind;
  desc: string;
  /** 无大模型 key 时是否仍可执行(A 档用例为 true) */
  offlineOk: boolean;
}

export interface IntentCase extends BaseCase {
  kind: 'intent';
  query: string;
  hasCanvas: boolean;
  expectIntent: 'generate' | 'modify' | 'consult';
  /** 规则层是否应判为歧义(歧义时走模型兜底/启发式沿用) */
  expectAmbiguous?: boolean;
}

export interface SchemaCase extends BaseCase {
  kind: 'schema';
  target: 'chat' | 'draft' | 'patch';
  payload: unknown;
  expectValid: boolean;
}

export interface TemplateCase extends BaseCase {
  kind: 'template';
  query: string;
  expectMatched: boolean;
  expectTemplateId?: string;
}

export interface GraphCase extends BaseCase {
  kind: 'graph';
  draft: any;
  expectValid: boolean;
  expectIssues?: string[];
  /** 期望存在的 warning 级 issue(不阻断) */
  expectWarnings?: string[];
}

export interface ToolCase extends BaseCase {
  kind: 'tool';
  name: string;
  params: Record<string, unknown>;
  expectStatus: 'ok' | 'fail';
  expectErrorType?: 'network' | 'param' | 'fail';
}

export interface E2eCase extends BaseCase {
  kind: 'e2e';
  query: string;
  sessionId: string;
  canvas?: Array<{ id: string; label: string; type: string }>;
  expectIntent: 'generate' | 'modify' | 'consult';
  expectResultKind: 'generate' | 'modify' | 'consult' | 'error';
  /** 期望的轨迹终止条件 */
  expectTermination: string;
  expectTemplateMatched?: boolean;
  /** fake 大模型对 generate/modify 的应答(JSON 文本) */
  llmReply?: string;
  /** consult 场景的应答文本 */
  consultReply?: string;
}

export type EvalCase = IntentCase | SchemaCase | TemplateCase | GraphCase | ToolCase | E2eCase;

/* ---------------- 公共夹具 ---------------- */

/** 带画布的 modify 场景夹具:一个最小合法审批链 */
export const SIMPLE_CANVAS = [
  { id: 'n1', label: '开始', type: 'start' },
  { id: 'n2', label: '提交申请', type: 'process' },
  { id: 'n3', label: '主管审批', type: 'decision' },
  { id: 'n4', label: '结束', type: 'end' },
] as const;

/** 合法的自定义流程草稿(含决策双分支) */
export const VALID_DRAFT = {
  nodes: [
    { id: 'n1', label: '开始', type: 'start' },
    { id: 'n2', label: '提交预订单', type: 'process' },
    { id: 'n3', label: '库存校验', type: 'decision' },
    { id: 'n4', label: '生成订单', type: 'process' },
    { id: 'n5', label: '缺货通知', type: 'io' },
    { id: 'n6', label: '结束', type: 'end' },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4', label: '有货' },
    { id: 'e4', source: 'n3', target: 'n5', label: '缺货' },
    { id: 'e5', source: 'n4', target: 'n6' },
    { id: 'e6', source: 'n5', target: 'n6' },
  ],
};

/** 含审批退回环的合法草稿(环只告警不阻断) */
export const CYCLE_DRAFT = {
  nodes: [
    { id: 'n1', label: '开始', type: 'start' },
    { id: 'n2', label: '提交申请', type: 'process' },
    { id: 'n3', label: '主管审批', type: 'decision' },
    { id: 'n4', label: '结束', type: 'end' },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
    { id: 'e3', source: 'n3', target: 'n4', label: '是' },
    { id: 'e4', source: 'n3', target: 'n2', label: '否' },
  ],
};

/** 缺陷草稿:决策节点只有单分支 + 孤岛节点 */
export const BROKEN_DRAFT = {
  nodes: [
    { id: 'n1', label: '开始', type: 'start' },
    { id: 'n2', label: '审批', type: 'decision' },
    { id: 'n3', label: '结束', type: 'end' },
    { id: 'n9', label: '孤岛', type: 'process' },
  ],
  edges: [
    { id: 'e1', source: 'n1', target: 'n2' },
    { id: 'e2', source: 'n2', target: 'n3' },
  ],
};

/** 合法的 add_node patch */
export const VALID_PATCH_ADD = {
  operations: [
    {
      op: 'add_node',
      semantic: { label: 'HR 复核', nodeType: 'process' },
      position: { relativeTo: { label: '主管审批' }, direction: 'bottom' },
    },
    { op: 'add_edge', semantic: { source: '主管审批', target: 'HR 复核', label: '是' } },
  ],
};

/** 合法的 delete_node patch */
export const VALID_PATCH_DELETE = {
  operations: [{ op: 'delete_node', target: { type: 'node', oldLabel: '提交申请' } }],
};

/** 合法的 modify_node patch(含受限视觉枚举) */
export const VALID_PATCH_MODIFY = {
  operations: [
    {
      op: 'modify_node',
      target: { type: 'node', oldLabel: '提交申请' },
      semantic: { label: '提交请假单' },
      visual: { fillColor: '#E6F4FF', fontSize: 14 },
    },
  ],
};

/* ---------------- 用例集 ---------------- */

export const INTENT_CASES: IntentCase[] = [
  {
    id: 'intent-generate-basic',
    kind: 'intent',
    desc: 'generate:明确的生成动词',
    offlineOk: true,
    query: '帮我生成一个请假审批流程',
    hasCanvas: false,
    expectIntent: 'generate',
  },
  {
    id: 'intent-generate-draw',
    kind: 'intent',
    desc: 'generate:口语「画一个」',
    offlineOk: true,
    query: '画一个报销流程',
    hasCanvas: false,
    expectIntent: 'generate',
  },
  {
    id: 'intent-consult-why',
    kind: 'intent',
    desc: 'consult:疑问句(为什么 + 问号)',
    offlineOk: true,
    query: '为什么决策节点需要两个分支？',
    hasCanvas: true,
    expectIntent: 'consult',
  },
  {
    id: 'intent-consult-how',
    kind: 'intent',
    desc: 'consult:「如何」类咨询',
    offlineOk: true,
    query: '如何让流程支持退回重新提交',
    hasCanvas: false,
    expectIntent: 'consult',
  },
  {
    id: 'intent-modify-add',
    kind: 'intent',
    desc: 'modify:有画布 + 增加节点',
    offlineOk: true,
    query: '在主管审批后面加上一个 HR 复核节点',
    hasCanvas: true,
    expectIntent: 'modify',
  },
  {
    id: 'intent-modify-rename',
    kind: 'intent',
    desc: 'modify:「把…改成」句式',
    offlineOk: true,
    query: '把提交申请节点的文案改成提交请假单',
    hasCanvas: true,
    expectIntent: 'modify',
  },
  {
    id: 'intent-modify-no-canvas-degrade',
    kind: 'intent',
    desc: 'modify 无画布 → 降级为 generate(歧义)',
    offlineOk: true,
    query: '修改这个流程',
    hasCanvas: false,
    expectIntent: 'generate',
    expectAmbiguous: true,
  },
  {
    id: 'intent-mixed-verbs',
    kind: 'intent',
    desc: '生成 + 修改动词同时命中 → 判为歧义并沿用规则结论',
    offlineOk: true,
    query: '帮我生成一个请假审批流程，并且加上考勤确认',
    hasCanvas: false,
    expectIntent: 'generate',
    expectAmbiguous: true,
  },
];

export const SCHEMA_CASES: SchemaCase[] = [
  {
    id: 'schema-chat-empty',
    kind: 'schema',
    desc: '边界:空消息应被 ChatRequestSchema 拒绝',
    offlineOk: true,
    target: 'chat',
    payload: { message: '' },
    expectValid: false,
  },
  {
    id: 'schema-chat-blank',
    kind: 'schema',
    desc: '边界:纯空白消息(长度合规，交由清洗层处理)',
    offlineOk: true,
    target: 'chat',
    payload: { message: '   ' },
    expectValid: true,
  },
  {
    id: 'schema-chat-too-long',
    kind: 'schema',
    desc: '边界:超长消息(2001 字)应被拒绝',
    offlineOk: true,
    target: 'chat',
    payload: { message: '流'.repeat(2001) },
    expectValid: false,
  },
  {
    id: 'schema-chat-max-ok',
    kind: 'schema',
    desc: '边界:恰好 2000 字应通过',
    offlineOk: true,
    target: 'chat',
    payload: { message: '流'.repeat(2000) },
    expectValid: true,
  },
  {
    id: 'schema-chat-invalid-node-type',
    kind: 'schema',
    desc: '边界:画布节点类型不在枚举内应被拒绝',
    offlineOk: true,
    target: 'chat',
    payload: { message: '改一下', canvas: [{ id: 'n1', label: 'x', type: 'hexagon' }] },
    expectValid: false,
  },
  {
    id: 'schema-chat-ok',
    kind: 'schema',
    desc: '正常请求体通过校验',
    offlineOk: true,
    target: 'chat',
    payload: { message: '生成请假流程', sessionId: 's1', projectId: 'p1' },
    expectValid: true,
  },
  {
    id: 'schema-draft-ok',
    kind: 'schema',
    desc: '合法 FlowDraft 通过校验',
    offlineOk: true,
    target: 'draft',
    payload: VALID_DRAFT,
    expectValid: true,
  },
  {
    id: 'schema-draft-single-node',
    kind: 'schema',
    desc: '边界:仅 1 个节点的 FlowDraft 应被拒绝(min 2)',
    offlineOk: true,
    target: 'draft',
    payload: { nodes: [{ id: 'n1', label: '开始', type: 'start' }], edges: [] },
    expectValid: false,
  },
  {
    id: 'schema-draft-bad-type',
    kind: 'schema',
    desc: '边界:非法节点类型应被拒绝',
    offlineOk: true,
    target: 'draft',
    payload: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '怪', type: 'hexagon' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    },
    expectValid: false,
  },
  {
    id: 'schema-draft-edge-missing-field',
    kind: 'schema',
    desc: '边界:边缺少 target 应被拒绝',
    offlineOk: true,
    target: 'draft',
    payload: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '结束', type: 'end' },
      ],
      edges: [{ id: 'e1', source: 'n1' }],
    },
    expectValid: false,
  },
  {
    id: 'schema-patch-add-ok',
    kind: 'schema',
    desc: '合法 add_node patch 通过校验',
    offlineOk: true,
    target: 'patch',
    payload: VALID_PATCH_ADD,
    expectValid: true,
  },
  {
    id: 'schema-patch-delete-ok',
    kind: 'schema',
    desc: '合法 delete_node patch 通过校验',
    offlineOk: true,
    target: 'patch',
    payload: VALID_PATCH_DELETE,
    expectValid: true,
  },
  {
    id: 'schema-patch-modify-ok',
    kind: 'schema',
    desc: '合法 modify_node(含视觉白名单)patch 通过校验',
    offlineOk: true,
    target: 'patch',
    payload: VALID_PATCH_MODIFY,
    expectValid: true,
  },
  {
    id: 'schema-patch-empty-ops',
    kind: 'schema',
    desc: '边界:空 operations 应被拒绝(min 1)',
    offlineOk: true,
    target: 'patch',
    payload: { operations: [] },
    expectValid: false,
  },
  {
    id: 'schema-patch-unknown-op',
    kind: 'schema',
    desc: '边界:未登记的 op 应被拒绝(防幻觉)',
    offlineOk: true,
    target: 'patch',
    payload: { operations: [{ op: 'explode_canvas' }] },
    expectValid: false,
  },
  {
    id: 'schema-patch-bad-color',
    kind: 'schema',
    desc: '边界:视觉色值非 #RRGGBB 应被拒绝',
    offlineOk: true,
    target: 'patch',
    payload: {
      operations: [
        {
          op: 'modify_node',
          target: { type: 'node', oldLabel: 'x' },
          visual: { fillColor: 'red' },
        },
      ],
    },
    expectValid: false,
  },
  {
    id: 'schema-patch-add-missing-position',
    kind: 'schema',
    desc: '边界:add_node 缺 position 应被拒绝',
    offlineOk: true,
    target: 'patch',
    payload: { operations: [{ op: 'add_node', semantic: { label: 'x', nodeType: 'process' } }] },
    expectValid: false,
  },
];

export const TEMPLATE_CASES: TemplateCase[] = [
  {
    id: 'tpl-leave-hit',
    kind: 'template',
    desc: '模板命中:请假审批',
    offlineOk: true,
    query: '帮我生成一个请假审批流程',
    expectMatched: true,
    expectTemplateId: 'leave-approval',
  },
  {
    id: 'tpl-expense-hit',
    kind: 'template',
    desc: '模板命中:费用报销',
    offlineOk: true,
    query: '生成一个费用报销流程',
    expectMatched: true,
    expectTemplateId: 'expense-reimbursement',
  },
  {
    id: 'tpl-customization-blocked',
    kind: 'template',
    desc: '含定制需求(加上)时不命中模板，转 LLM 生成',
    offlineOk: true,
    query: '帮我生成一个请假审批流程，并且加上考勤确认',
    expectMatched: false,
  },
  {
    id: 'tpl-modify-blocked',
    kind: 'template',
    desc: '修改类请求不命中模板',
    offlineOk: true,
    query: '修改请假流程',
    expectMatched: false,
  },
  {
    id: 'tpl-no-keyword',
    kind: 'template',
    desc: '无关键词不命中模板',
    offlineOk: true,
    query: '生成一个采购比价流程',
    expectMatched: false,
  },
];

export const GRAPH_CASES: GraphCase[] = [
  {
    id: 'graph-valid-linear',
    kind: 'graph',
    desc: '合法线性图通过校验且无 issue',
    offlineOk: true,
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '提交', type: 'process' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    },
    expectValid: true,
  },
  {
    id: 'graph-valid-decision',
    kind: 'graph',
    desc: '决策双分支图通过校验',
    offlineOk: true,
    draft: VALID_DRAFT,
    expectValid: true,
  },
  {
    id: 'graph-cycle-warning-only',
    kind: 'graph',
    desc: '审批退回环:HAS_CYCLE 仅告警，不阻断产出',
    offlineOk: true,
    draft: CYCLE_DRAFT,
    expectValid: true,
    expectWarnings: ['HAS_CYCLE'],
  },
  {
    id: 'graph-builtin-templates-valid',
    kind: 'graph',
    desc: '内置模板自带合法回环，校验必须通过(否则模板短路会被反思打回)',
    offlineOk: true,
    draft: '__BUILTIN_TEMPLATES__' as any,
    expectValid: true,
    expectWarnings: ['HAS_CYCLE'],
  },
  {
    id: 'graph-broken-decision-and-unreachable',
    kind: 'graph',
    desc: '缺陷图:决策单分支 + 孤岛节点(级联报不可达与无出边)',
    offlineOk: true,
    draft: BROKEN_DRAFT,
    expectValid: false,
    expectIssues: ['DECISION_NO_BRANCH', 'NO_OUTPUT_BRANCH', 'UNREACHABLE_NODE'],
  },
  {
    id: 'graph-dangling-edge',
    kind: 'graph',
    desc: '边引用不存在节点判 error(主链完整，隔离验证该规则)',
    offlineOk: true,
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n1', target: 'ghost' },
      ],
    },
    expectValid: false,
    expectIssues: ['EDGE_REFERENCES_MISSING_NODE'],
  },
  {
    id: 'graph-missing-start-end',
    kind: 'graph',
    desc: '缺 start/end 判 error(孤立 process 同时报无出边)',
    offlineOk: true,
    draft: { nodes: [{ id: 'n1', label: 'A', type: 'process' }], edges: [] },
    expectValid: false,
    expectIssues: ['MISSING_END', 'MISSING_START', 'NO_OUTPUT_BRANCH'],
  },
  {
    id: 'graph-duplicate-id',
    kind: 'graph',
    desc: '节点 id 重复判 error',
    offlineOk: true,
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n1', label: '重复', type: 'process' },
        { id: 'n2', label: '结束', type: 'end' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    },
    expectValid: false,
    expectIssues: ['NO_UNIQUE_ID'],
  },
  {
    id: 'graph-no-output-branch',
    kind: 'graph',
    desc: '中间节点断头判 error，end 无出边合法',
    offlineOk: true,
    draft: {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '断头', type: 'process' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      // n3 经 e2 可达，确保只暴露 n2 断头这一处问题
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n1', target: 'n3' },
      ],
    },
    expectValid: false,
    expectIssues: ['NO_OUTPUT_BRANCH'],
  },
];

export const TOOL_CASES: ToolCase[] = [
  {
    id: 'tool-template-match-hit',
    kind: 'tool',
    desc: 'template_match 命中返回模板草稿',
    offlineOk: true,
    name: 'template_match',
    params: { query: '生成请假审批流程' },
    expectStatus: 'ok',
  },
  {
    id: 'tool-template-match-miss',
    kind: 'tool',
    desc: 'template_match 未命中仍为 ok(matched=false)',
    offlineOk: true,
    name: 'template_match',
    params: { query: '生成采购比价流程' },
    expectStatus: 'ok',
  },
  {
    id: 'tool-template-match-empty-param',
    kind: 'tool',
    desc: '边界:template_match 空 query 判 param 错误',
    offlineOk: true,
    name: 'template_match',
    params: { query: '' },
    expectStatus: 'fail',
    expectErrorType: 'param',
  },
  {
    id: 'tool-validate-graph-ok',
    kind: 'tool',
    desc: 'validate_graph 校验合法草稿',
    offlineOk: true,
    name: 'validate_graph',
    params: { draft: VALID_DRAFT },
    expectStatus: 'ok',
  },
  {
    id: 'tool-validate-graph-json-string',
    kind: 'tool',
    desc: 'validate_graph 接受 JSON 字符串入参',
    offlineOk: true,
    name: 'validate_graph',
    params: { draft: JSON.stringify(CYCLE_DRAFT) },
    expectStatus: 'ok',
  },
  {
    id: 'tool-validate-graph-missing-param',
    kind: 'tool',
    desc: '边界:validate_graph 缺 draft 判 param 错误',
    offlineOk: true,
    name: 'validate_graph',
    params: {},
    expectStatus: 'fail',
    expectErrorType: 'param',
  },
  {
    id: 'tool-unknown-name',
    kind: 'tool',
    desc: '边界:白名单外工具直接拒绝',
    offlineOk: true,
    name: 'drop_database',
    params: {},
    expectStatus: 'fail',
  },
];

export const E2E_CASES: E2eCase[] = [
  {
    id: 'e2e-template-shortcut',
    kind: 'e2e',
    desc: '端到端:模板命中短路，不消耗大模型 token',
    offlineOk: false,
    query: '帮我生成一个请假审批流程',
    sessionId: 'eval-session-tpl',
    expectIntent: 'generate',
    expectResultKind: 'generate',
    expectTermination: 'template_shortcut',
    expectTemplateMatched: true,
  },
  {
    id: 'e2e-generate-custom',
    kind: 'e2e',
    desc: '端到端:定制需求走 LLM 生成并通过两层校验',
    offlineOk: false,
    query: '生成一个采购比价流程',
    sessionId: 'eval-session-gen',
    expectIntent: 'generate',
    expectResultKind: 'generate',
    expectTermination: 'valid_result',
    expectTemplateMatched: false,
    llmReply: JSON.stringify(VALID_DRAFT),
  },
  {
    id: 'e2e-modify-add-node',
    kind: 'e2e',
    desc: '端到端:画布增量修改(add_node)',
    offlineOk: false,
    query: '在主管审批后面加上一个 HR 复核节点',
    sessionId: 'eval-session-mod',
    canvas: SIMPLE_CANVAS as any,
    expectIntent: 'modify',
    expectResultKind: 'modify',
    expectTermination: 'valid_result',
    llmReply: JSON.stringify(VALID_PATCH_ADD),
  },
  {
    id: 'e2e-modify-delete-node',
    kind: 'e2e',
    desc: '端到端:画布增量修改(delete_node)',
    offlineOk: false,
    query: '把提交申请节点删掉',
    sessionId: 'eval-session-del',
    canvas: SIMPLE_CANVAS as any,
    expectIntent: 'modify',
    expectResultKind: 'modify',
    expectTermination: 'valid_result',
    llmReply: JSON.stringify(VALID_PATCH_DELETE),
  },
  {
    id: 'e2e-consult',
    kind: 'e2e',
    desc: '端到端:咨询类问题直接回答，不产图',
    offlineOk: false,
    query: '为什么决策节点需要两个分支？',
    sessionId: 'eval-session-ask',
    expectIntent: 'consult',
    expectResultKind: 'consult',
    expectTermination: 'consult_answer',
    consultReply: '决策节点表示分支判断，至少需要两个出口（如「是/否」），否则流程无法分流。',
  },
  {
    id: 'e2e-generate-fenced-json',
    kind: 'e2e',
    desc: '端到端:模型输出带 ```json 围栏也能解析(格式合规)',
    offlineOk: false,
    query: '画一个招聘面试流程',
    sessionId: 'eval-session-fence',
    expectIntent: 'generate',
    expectResultKind: 'generate',
    expectTermination: 'valid_result',
    llmReply: '```json\n' + JSON.stringify(VALID_DRAFT) + '\n```',
  },
];

export const ALL_CASES: EvalCase[] = [
  ...INTENT_CASES,
  ...SCHEMA_CASES,
  ...TEMPLATE_CASES,
  ...GRAPH_CASES,
  ...TOOL_CASES,
  ...E2E_CASES,
];
