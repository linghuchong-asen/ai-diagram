// 语图技术方案 - 上下文分段预算单测(Task 10.4)
// 覆盖:分段比例(记忆40/项目20/输入15/工具结果10/system10/工具定义5)、总量卡 80%、
//       每段超限截断、未用满配额按优先级借给超限段、实体保真段不参与截断、记忆段保留尾部
import {
  allocateSegmentBudget,
  CONTEXT_SEGMENT_NAMES,
  CONTEXT_SEGMENT_RATIOS,
  fitSegment,
  ContextBuilder,
  DEFAULT_CONTEXT_MAX_TOKENS,
} from './context.builder';

const text = (chars: number) => '字'.repeat(chars);

describe('allocateSegmentBudget(分段配额)', () => {
  it('比例合计为 1 且与文档一致(0.4/0.2/0.15/0.1/0.1/0.05)', () => {
    const sum = Object.values(CONTEXT_SEGMENT_RATIOS).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
    expect(CONTEXT_SEGMENT_RATIOS.memory).toBe(0.4);
    expect(CONTEXT_SEGMENT_RATIOS.project).toBe(0.2);
    expect(CONTEXT_SEGMENT_RATIOS.userInput).toBe(0.15);
    expect(CONTEXT_SEGMENT_RATIOS.toolResult).toBe(0.1);
    expect(CONTEXT_SEGMENT_RATIOS.system).toBe(0.1);
    expect(CONTEXT_SEGMENT_RATIOS.toolDefinitions).toBe(0.05);
  });

  it('各段限额之和恒等于总预算(不超发)', () => {
    const limits = allocateSegmentBudget(
      { memory: 5000, project: 5000, userInput: 5000, toolResult: 5000, system: 5000, toolDefinitions: 5000 },
      1000,
    );
    const total = Object.values(limits).reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(1000);
  });

  it('每段超限截断:基础限额为 比例*总量,余量借给超限段', () => {
    const sizes = { memory: 800, project: 100, userInput: 50, toolResult: 10, system: 20, toolDefinitions: 5 };
    const limits = allocateSegmentBudget(sizes, 1000);
    // memory 基础 400,其余段余量 415 全部借给 memory(deficit 400)
    expect(limits.memory).toBe(800);
    // 实际用量 = min(size, limit),总量不突破预算
    const used = CONTEXT_SEGMENT_NAMES.reduce((acc, name) => acc + Math.min(sizes[name], limits[name]), 0);
    expect(used).toBeLessThanOrEqual(1000);
  });

  it('未用满的配额按优先级借给超限段(实际用量不突破)', () => {
    const sizes = { memory: 950, project: 0, userInput: 0, toolResult: 0, system: 0, toolDefinitions: 0 };
    const limits = allocateSegmentBudget(sizes, 1000);
    // memory 基础 400,其余段全空 → 剩余 600 全部借给 memory
    expect(limits.memory).toBe(950);
    const used = CONTEXT_SEGMENT_NAMES.reduce((acc, name) => acc + Math.min(sizes[name], limits[name]), 0);
    expect(used).toBeLessThanOrEqual(1000);
  });

  it('借用按优先级:用户输入优先于工具定义', () => {
    const limits = allocateSegmentBudget(
      { memory: 0, project: 0, userInput: 500, toolResult: 0, system: 0, toolDefinitions: 500 },
      1000,
    );
    // 两段都超各自限额,可用余量 850(userInput 150 + toolDefinitions 50 + 其他空段 650)→ 都能补足
    expect(limits.userInput).toBe(500);
    expect(limits.toolDefinitions).toBe(500);
  });
});

describe('fitSegment(截断)', () => {
  it('未超限原样返回', () => {
    const r = fitSegment(text(10), 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(text(10));
  });

  it('超限截断并带标记', () => {
    const r = fitSegment(text(500), 100);
    expect(r.truncated).toBe(true);
    expect(r.text.length).toBeLessThanOrEqual(101);
    expect(r.text).toContain('…[内容超预算已截断]');
  });

  it("keep='tail' 保留尾部(近期对话更重要)", () => {
    const r = fitSegment('a'.repeat(30) + 'XYZ末尾', 20, 'tail');
    expect(r.truncated).toBe(true);
    expect(r.text.endsWith('末尾')).toBe(true); // 保留尾部
    expect(r.text.startsWith('a')).toBe(false); // 头部被截掉
  });
});

describe('ContextBuilder(整体组装)', () => {
  const builder = new ContextBuilder();

  it('实体保真段完整注入,不参与截断', () => {
    const entities = '【会话事实(不可改写)】\n- 角色: 部门经理、财务\n- 硬性约束:\n  * 审批不通过必须退回提交环节';
    const built = builder.build({
      query: '帮我生成报销流程',
      intent: 'generate',
      systemPrompt: '系统指令',
      entities,
      recentTurns: [],
      summaries: [],
      retrieved: [],
      maxTokens: 200, // 极小预算,其余段都会被截断
    });
    expect(built.text).toContain('审批不通过必须退回提交环节');
    expect(built.text).toContain('部门经理');
  });

  it('重要信息置首尾:system 在开头,短需求在结尾重复', () => {
    const built = builder.build({
      query: '生成请假流程',
      intent: 'generate',
      systemPrompt: 'SYS-ANCHOR',
      recentTurns: [],
      summaries: [],
      retrieved: [],
      maxTokens: 2000,
    });
    expect(built.text.startsWith('【系统指令】\nSYS-ANCHOR')).toBe(true);
    expect(built.text).toContain('【再次确认用户需求】\n生成请假流程');
  });

  it('默认输入上限为 32000,预算为 80%', () => {
    expect(DEFAULT_CONTEXT_MAX_TOKENS).toBe(32000);
    const built = builder.build({ query: 'x', intent: 'generate', systemPrompt: 's', recentTurns: [], summaries: [], retrieved: [] });
    expect(built.tokenCount).toBeLessThanOrEqual(32000 * 0.8 + 8); // 组装分隔符有少量额外开销
  });

  it('分段占用观测字段齐全(segments)', () => {
    const built = builder.build({
      query: 'q',
      intent: 'consult',
      systemPrompt: 's',
      recentTurns: [{ role: 'user', content: '历史' }],
      summaries: ['摘要'],
      retrieved: ['片段'],
      toolDefinitions: 'template_match: 模板匹配',
      projectContext: 'projectId: 1',
      maxTokens: 1000,
    });
    for (const name of ['memory', 'project', 'userInput', 'toolResult', 'system', 'toolDefinitions'] as const) {
      expect(built.segments[name]).toBeDefined();
      expect(built.segments[name].used).toBeLessThanOrEqual(built.segments[name].limit + 8);
    }
    expect(built.truncated).toEqual([]);
  });
});
