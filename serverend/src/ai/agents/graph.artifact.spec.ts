// 语图技术方案 - 多形态产物状态图集成单测(multi-artifact-batch Round 6)
// 覆盖四条关键路径(不起 Nest TestingModule,与 ai.service.spec 同款纯逻辑直测):
//   ① generate + formHint → 形态路由生效 → 按形态选 prompt/解析/校验 → result 带 artifactKind 与对应 payload;
//   ② 格式/结构失败 → Rewriter 修正循环(修正提示词含形态措辞)→ 修正成功;
//   ③ 修正超限 → 人在回路挂起,候选数据为产物本体;
//   ④ flowchart 回归:无 formHint 时行为与旧链路完全一致(result 无 artifactKind 字段);
//   ⑤ service 层:formHint 透传 + accept 还原 artifact 候选。
import { FlowStateGraph } from './graph';
import { ReflectionEvaluator } from '../reflection/evaluator';
import { Rewriter } from '../reflection/rewriter';
import { FormRouter } from '../form/form.router';
import { AiService } from '../ai.service';

/** 流式 chunk 异步生成器(callLlm 消费 llm.stream() 的异步迭代协议) */
async function* streamOf(text: string) {
  yield { content: text };
}

/** 合法对比表格 JSON(带思考标签,模拟模型真实输出形态) */
const TABLE_REPLY = `<thinking>用户要对比三个方案,按成本/工期/维护展开。</thinking>
{"columns":["维度","自建","采购"],"rows":[["成本","3 人月","年费 12 万"],["工期","3 个月","2 周上线"]],"conclusion":"工期紧张推荐采购"}`;

/** 结构非法表格(空白单元格,过 Zod 但触发结构校验 error) */
const TABLE_EMPTY_CELL_REPLY = `<thinking>对比</thinking>
{"columns":["维度","自建","采购"],"rows":[["成本","3 人月","   "],["工期","3 个月","2 周上线"]]}`;

/** 合法流程图 JSON(flowchart 回归基线) */
const FLOW_REPLY = `<thinking>请假流程。</thinking>
{"nodes":[{"id":"n1","label":"开始","type":"start"},{"id":"n2","label":"主管审批","type":"process"},{"id":"n3","label":"结束","type":"end"}],"edges":[{"id":"e1","source":"n1","target":"n2"},{"id":"e2","source":"n2","target":"n3"}]}`;

/**
 * 组装 FlowStateGraph(依赖全为最小桩;反思/Rewriter 用真实实现保证校验语义)。
 * llmReplies 按次序出队:模拟「失败 → 修正成功」的多轮生成。
 * traceService(Round 14):可选注入 fake,用于断言形式路由埋点。
 */
function makeGraph(options: {
  llmReplies: string[];
  formRoute: { kind: any; source: any; reasons?: string[] };
  formHint?: any;
  maxRewrites?: number;
  traceService?: any;
}) {
  const replies = [...options.llmReplies];
  const llmCalls: any[] = [];
  const llmFactory = {
    getModels: () => ({
      large: {
        stream: async (messages: any) => {
          llmCalls.push(messages);
          return streamOf(replies.shift() ?? '');
        },
      },
      medium: { stream: async () => streamOf(''), invoke: async () => ({ content: '' }) },
    }),
    getMaxOutputTokens: () => 4096,
  };
  const buildCalls: any[] = [];
  const contextBuilder = {
    build: (input: any) => {
      buildCalls.push(input);
      return { text: `${input.systemPrompt}\n【用户需求】${input.query}`, truncated: [], segments: {}, tokenCount: 10 };
    },
  };
  const checkpoints = {
    getSaverName: () => 'memory',
    get: async () => ({ messages: [], lastSummary: undefined }),
    saveTurn: async () => undefined,
    trimMessages: async () => 0,
  };
  const graph = new FlowStateGraph(
    { recognize: async () => ({ intent: 'generate', source: 'rule', confidence: 1, reasons: [], llmAttempted: false }) } as never, // intentRecognizer
    contextBuilder as never,
    new ReflectionEvaluator(), // 真实校验器
    new Rewriter(), // 真实 Rewriter(验证修正提示词组装)
    { execute: async () => ({ status: 'ok', tool: 'template_match', data: { matched: false } }) } as never, // toolExecutor
    llmFactory as never,
    checkpoints as never,
    { listForSession: async () => [], searchWithMeta: async () => ({ records: [], degraded: [] }) } as never,
    { maybeSummarize: async () => undefined } as never,
    { render: () => '', ingest: () => undefined } as never,
    { whitelist: ['template_match'], getDefinition: () => null } as never,
    // FormRouter 桩:可控路由结果
    { route: async () => ({ kind: options.formRoute.kind, source: options.formRoute.source, reasons: options.formRoute.reasons ?? [], llmAttempted: false }) } as unknown as FormRouter,
    // Round 14:第 12 位是 @Optional embedder(本案不需要),第 13 位传 traceService fake
    undefined as never,
    options.traceService,
  );
  return { graph, llmCalls, buildCalls };
}

describe('多形态产物状态图集成(multi-artifact-batch Round 6)', () => {
  it('① generate+formHint=table:模板短路跳过,result 带 artifactKind 与 tableDraft', async () => {
    const { graph, buildCalls } = makeGraph({
      llmReplies: [TABLE_REPLY],
      formRoute: { kind: 'table', source: 'hint' },
      formHint: 'table',
    });
    const { state } = await graph.run({
      threadId: 't1',
      query: '对比一下自建和采购',
      intent: 'generate',
      formHint: 'table',
    });
    // 路由结果写入 state(观测字段)
    expect(state.artifactKind).toBe('table');
    expect(state.artifactSource).toBe('hint');
    // 上下文使用 table 形态系统提示词(而非流程图 SYSTEM_PROMPT)
    const systemPrompt = buildCalls[0]?.systemPrompt ?? '';
    expect(systemPrompt).toContain('对比表格');
    // result:形态 + payload 配对
    const result = state.result as any;
    expect(result.kind).toBe('generate');
    expect(result.artifactKind).toBe('table');
    expect(result.tableDraft.columns).toEqual(['维度', '自建', '采购']);
    expect(result.tableDraft.rows.length).toBe(2);
    expect(state.artifact).toBeDefined();
  });

  it('② 结构失败 → Rewriter 修正循环(形态措辞)→ 第二次成功', async () => {
    const { graph, llmCalls } = makeGraph({
      llmReplies: [TABLE_EMPTY_CELL_REPLY, TABLE_REPLY],
      formRoute: { kind: 'table', source: 'rule' },
    });
    const { state } = await graph.run({ threadId: 't2', query: '对比一下自建和采购的优缺点', intent: 'generate' });
    expect(state.rewriteCount).toBe(1);
    const result = state.result as any;
    expect(result.artifactKind).toBe('table');
    expect(result.tableDraft.rows[0][2]).toBe('年费 12 万');
    // 修正轮的 LLM 输入是 Rewriter 产物:含形态修正措辞(「元素」而非「节点与边」)
    const secondCall = llmCalls[1]?.[0]?.content ?? llmCalls[1]?.[0];
    expect(JSON.stringify(llmCalls[1])).toContain('局部修正指令');
  });

  it('③ 修正超限 → 人在回路挂起,候选方案为产物本体(table)', async () => {
    const { graph } = makeGraph({
      llmReplies: [TABLE_EMPTY_CELL_REPLY],
      formRoute: { kind: 'table', source: 'rule' },
      maxRewrites: 0,
    });
    const { state } = await graph.run({
      threadId: 't3',
      query: '对比一下自建和采购的优缺点',
      intent: 'generate',
      maxRewrites: 0,
    });
    expect(state.needHumanConfirm).toBe(true);
    expect(state.suspended).toBe(true);
    // 候选方案 1 的数据是 table 产物本体;文案按形态调整(不含「画布上手动微调」)
    const accept = state.confirmPayload?.candidates.find((c) => c.id === 'accept-current');
    expect(accept).toBeDefined();
    expect((accept?.data as any).columns).toBeDefined();
    expect(accept?.note).toContain('继续对话调整');
  });

  it('④ flowchart 回归:无 formHint 时 result 保持旧形态(无 artifactKind 字段)', async () => {
    const { graph, buildCalls } = makeGraph({
      llmReplies: [FLOW_REPLY],
      formRoute: { kind: 'flowchart', source: 'default' },
    });
    const { state } = await graph.run({ threadId: 't4', query: '画一个请假审批流程图', intent: 'generate' });
    const result = state.result as any;
    expect(result.kind).toBe('generate');
    expect(result.flowDraft.nodes.length).toBe(3);
    // 旧客户端关键兼容点:响应体不出现 artifactKind 字段(undefined 不序列化为新行为)
    expect('artifactKind' in result).toBe(false);
    // 上下文回退到流程图 SYSTEM_PROMPT
    expect(buildCalls[0]?.systemPrompt).toContain('流程图');
  });

  it('⑥ 形式路由观测埋点(competitor-driven-evolution-batch Round 14):FORM_ROUTE 步骤 + updateRun.artifactKind', async () => {
    const fakeTraceService = {
      startRun: jest.fn(),
      recordStep: jest.fn(),
      updateRun: jest.fn(),
      finishRun: jest.fn(),
    };
    const { graph } = makeGraph({
      llmReplies: [TABLE_REPLY],
      formRoute: { kind: 'table', source: 'rule' },
      traceService: fakeTraceService,
    });
    await graph.run({ threadId: 't6', query: '对比一下自建和采购的优缺点', intent: 'generate' });
    // FORM_ROUTE 步骤被记录,meta 含 kind/source/llmAttempted 三个观测字段
    const formRouteCall = fakeTraceService.recordStep.mock.calls.find(
      (call: any[]) => call[0]?.stepName === 'form.route',
    );
    expect(formRouteCall).toBeDefined();
    expect(formRouteCall![0].meta).toEqual(
      expect.objectContaining({ kind: 'table', source: 'rule', llmAttempted: false }),
    );
    expect(formRouteCall![0].status).toBe('ok');
    // header 侧同步写入 artifactKind(形态分布离线分析用)
    expect(fakeTraceService.updateRun).toHaveBeenCalledWith('t6', { artifactKind: 'table' });
  });

  it('⑥ 恢复执行(artifactKind 已预置)时跳过形式路由,不记录 FORM_ROUTE 步骤', async () => {
    const fakeTraceService = {
      startRun: jest.fn(),
      recordStep: jest.fn(),
      updateRun: jest.fn(),
      finishRun: jest.fn(),
    };
    const { graph } = makeGraph({
      llmReplies: [TABLE_REPLY],
      formRoute: { kind: 'table', source: 'rule' },
      traceService: fakeTraceService,
    });
    // 人在回路 retry 预置 artifactKind:不再二次路由,保持形态稳定
    await graph.run({ threadId: 't7', query: '对比一下', intent: 'generate', artifactKind: 'table' });
    const formRouteCall = fakeTraceService.recordStep.mock.calls.find(
      (call: any[]) => call[0]?.stepName === 'form.route',
    );
    expect(formRouteCall).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// service 层:formHint 透传 + accept 还原 artifact 候选
// ---------------------------------------------------------------------------

/** AiService 全量桩(与 ai.service.spec 的 makeService 同款,补充 confirm 需要的 threadStore 能力) */
function makeService(suspendedState: Record<string, unknown>) {
  const graph = { run: jest.fn(async () => ({ state: { ...suspendedState } })) };
  const rec = {
    status: 'need_confirm',
    confirmPayload: {
      reason: 'test',
      issues: [],
      candidates: [{ id: 'accept-current', label: '采用当前版本', data: { events: [{ time: 'Day1', title: '抵达' }] } }],
    },
    resumeToken: 'rt-1',
    suspendedState,
  };
  const threadStore = {
    create: jest.fn(),
    get: jest.fn(() => rec),
    setResult: jest.fn(),
    setError: jest.fn(),
    setNeedConfirm: jest.fn(),
    resume: jest.fn(() => true),
  };
  const thinkStream = { publish: jest.fn(), end: jest.fn(), error: jest.fn() };
  const service = new AiService(
    graph as never,
    threadStore as never,
    thinkStream as never,
    { releaseThread: jest.fn() } as never,
    { get: jest.fn(async () => null), saveTurn: jest.fn(async () => undefined) } as never,
    { add: jest.fn(async () => undefined), listForSession: jest.fn(async () => []) } as never,
    { ingestFromConversation: jest.fn(async () => undefined) } as never,
    {
      assertCanRun: jest.fn(async () => ({})),
      consume: jest.fn(async () => undefined),
      addSessionUsage: jest.fn(() => ({ sessionTokens: 0 })),
    } as never,
    { get: () => undefined } as never,
    { track: jest.fn() } as never,
  );
  return { service, graph, threadStore };
}

describe('service 层多形态透传与还原(multi-artifact-batch Round 6)', () => {
  it('⑤ createThread 透传 formHint 给状态图', async () => {
    const { service, graph } = makeService({});
    await service.createThread({ userId: 'u1', message: '整理待办', formHint: 'checklist' });
    expect(graph.run).toHaveBeenCalledWith(expect.objectContaining({ formHint: 'checklist' }), expect.anything());
  });

  it('⑤ startTrial 透传 formHint(试用链路同构)', async () => {
    const { service, graph } = makeService({});
    await service.startTrial({ message: '整理待办', trialId: 't1', formHint: 'timeline' }, '1.1.1.1');
    expect(graph.run).toHaveBeenCalledWith(
      expect.objectContaining({ intent: 'generate', formHint: 'timeline' }),
      expect.anything(),
    );
  });

  it('⑤ accept 还原 artifact 候选:timeline 候选装入 timelineDraft 而非 flowDraft', async () => {
    const { service, threadStore } = makeService({ intent: 'generate', artifactKind: 'timeline' });
    await service.confirmThread('thread-1', { choice: 'accept', resumeToken: 'rt-1' });
    const result = (threadStore.setResult as jest.Mock).mock.calls[0][1];
    expect(result.kind).toBe('generate');
    expect(result.artifactKind).toBe('timeline');
    expect(result.timelineDraft.events.length).toBe(1);
    expect(result.flowDraft).toBeUndefined();
  });

  it('⑤ 会话形态台账(competitor-driven-evolution-batch Round 15):成功 generate 后累计,下次 createThread 传入', async () => {
    const { service, graph } = makeService({
      sessionId: 's1',
      intent: 'generate',
      artifactKind: 'table',
      result: { kind: 'generate', artifactKind: 'table' },
    });
    await service.createThread({ userId: 'u1', message: '对比一下', sessionId: 's1' });
    await service.createThread({ userId: 'u1', message: '再来一次对比', sessionId: 's1' });
    // 第一次运行成功后台账记 table=1;第二次 createThread 的 initial 带上该快照
    const second = (graph.run as jest.Mock).mock.calls[1][0];
    expect(second.sessionFormUsage).toEqual({ table: 1 });
  });
});
