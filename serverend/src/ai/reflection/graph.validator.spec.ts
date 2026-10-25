// Task 13.4:图遍历校验单测(重点覆盖 HAS_CYCLE 等边界)
import { GraphValidator, GraphIssueType } from './graph.validator';
import { FlowDraft } from '../schemas/flow-draft.schema';
import { TemplateMatcher } from '../tools/template-matcher';

const validator = new GraphValidator();

/** 最小合法链路:start → process → end */
function linearDraft(): FlowDraft {
  return {
    nodes: [
      { id: 'n1', label: '开始', type: 'start' },
      { id: 'n2', label: '提交申请', type: 'process' },
      { id: 'n3', label: '结束', type: 'end' },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2' },
      { id: 'e2', source: 'n2', target: 'n3' },
    ],
  } as FlowDraft;
}

function typesOf(result: { issues: Array<{ type: GraphIssueType }> }): GraphIssueType[] {
  return result.issues.map((i) => i.type);
}

describe('GraphValidator', () => {
  it('最小合法链路应通过且无 issue', () => {
    const result = validator.validate(linearDraft());
    expect(result.valid).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('审批退回形成的环:HAS_CYCLE 仅告警，不阻断产出', () => {
    const draft = {
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
    } as FlowDraft;

    const result = validator.validate(draft);
    expect(result.valid).toBe(true);

    const cycle = result.issues.find((i) => i.type === 'HAS_CYCLE');
    expect(cycle).toBeDefined();
    expect(cycle!.severity).toBe('warning');
    // 环路径写入 detail，且首尾闭合(n2 → n3 → n2)
    expect(cycle!.detail).toEqual(['n2', 'n3', 'n2']);
    expect(cycle!.nodeId).toBe('n2');
  });

  it('同一环被多条入边命中时只报一次', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: 'A', type: 'process' },
        { id: 'n3', label: 'B', type: 'process' },
        { id: 'n4', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
        { id: 'e3', source: 'n3', target: 'n2' },
        { id: 'e4', source: 'n3', target: 'n4' },
      ],
    } as FlowDraft;

    const result = validator.validate(draft);
    expect(result.issues.filter((i) => i.type === 'HAS_CYCLE')).toHaveLength(1);
  });

  it('无环图不应产生 HAS_CYCLE', () => {
    const result = validator.validate(linearDraft());
    expect(typesOf(result)).not.toContain('HAS_CYCLE');
  });

  it('缺少 start / end 应报 error 并阻断', () => {
    const draft = {
      nodes: [{ id: 'n1', label: 'A', type: 'process' }],
      edges: [],
    } as unknown as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    expect(typesOf(result)).toEqual(expect.arrayContaining(['MISSING_START', 'MISSING_END']));
  });

  it('非法节点类型报 INVALID_TYPE', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '奇怪', type: 'hexagon' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    } as unknown as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.type === 'INVALID_TYPE');
    expect(issue?.nodeId).toBe('n2');
  });

  it('节点 id 重复报 NO_UNIQUE_ID', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n1', label: '重复', type: 'process' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n3' },
      ],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    expect(typesOf(result)).toContain('NO_UNIQUE_ID');
  });

  it('边引用不存在的节点报 EDGE_REFERENCES_MISSING_NODE', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'ghost' }],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.type === 'EDGE_REFERENCES_MISSING_NODE');
    expect(issue?.detail).toEqual(['n1', 'ghost']);
    // 悬空的 end 因无入边同时被判不可达
    expect(typesOf(result)).toContain('UNREACHABLE_NODE');
  });

  it('end 节点没有出边是合法的，不报 NO_OUTPUT_BRANCH', () => {
    const result = validator.validate(linearDraft());
    expect(typesOf(result)).not.toContain('NO_OUTPUT_BRANCH');
  });

  it('中间节点没有出边报 NO_OUTPUT_BRANCH', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '断头', type: 'process' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.type === 'NO_OUTPUT_BRANCH');
    expect(issue?.nodeId).toBe('n2');
  });

  it('决策节点分支数 < 2 报 DECISION_NO_BRANCH', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '审批', type: 'decision' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    expect(typesOf(result)).toContain('DECISION_NO_BRANCH');
  });

  it('决策节点双分支(含退回环)视为合法', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '审批', type: 'decision' },
        { id: 'n3', label: '通过', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n2' },
        { id: 'e2', source: 'n2', target: 'n3', label: '是' },
        { id: 'e3', source: 'n2', target: 'n1', label: '否' },
      ],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(true);
    expect(typesOf(result)).not.toContain('DECISION_NO_BRANCH');
  });

  it('从 start 不可达的节点报 UNREACHABLE_NODE', () => {
    const draft = {
      nodes: [
        { id: 'n1', label: '开始', type: 'start' },
        { id: 'n2', label: '孤岛', type: 'process' },
        { id: 'n3', label: '结束', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'n1', target: 'n3' },
        { id: 'e2', source: 'n2', target: 'n3' },
      ],
    } as FlowDraft;
    const result = validator.validate(draft);
    expect(result.valid).toBe(false);
    const issue = result.issues.find((i) => i.type === 'UNREACHABLE_NODE');
    expect(issue?.nodeId).toBe('n2');
  });

  it('内置模板自带合法回环，校验必须通过(否则模板短路会被反思打回)', () => {
    const matcher = new TemplateMatcher();
    for (const keyword of ['请假审批流程', '费用报销流程']) {
      const matched = matcher.match(keyword);
      expect(matched.matched).toBe(true);
      const result = validator.validate(matched.template!.draft);
      expect(result.valid).toBe(true);
      expect(result.issues.every((i) => i.severity === 'warning')).toBe(true);
    }
  });
});
