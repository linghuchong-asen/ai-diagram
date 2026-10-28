// 语图技术方案 - 全形态模板短路集成单测(competitor-driven-evolution-batch Round 13)
// 覆盖(不起 Nest TestingModule,与 graph.artifact.spec 同款纯逻辑直测;
//       ToolExecutor 桩代理真实 ToolRegistry+TemplateMatcher,保证「关键词→短路」真实语义):
//   ① 四新形态(checklist/table/timeline/mindmap)模板命中 → result 带 artifactKind 与对应 payload,零 LLM 调用;
//   ② 未命中关键词 → 继续走 LLM 生成(既有链路);
//   ③ 定制词(「要…」)→ 不命中模板,交还 LLM(模板只服务「通用骨架」请求);
//   ④ flowchart 回归:既有请假审批模板短路行为不变(result 无 artifactKind 字段)。
import { FlowStateGraph } from './graph';
import { ReflectionEvaluator } from '../reflection/evaluator';
import { Rewriter } from '../reflection/rewriter';
import { TemplateMatcher } from '../tools/template-matcher';
import { ToolRegistry } from '../tools/tool.registry';

/** 流式 chunk 异步生成器(callLlm 消费 llm.stream() 的异步迭代协议) */
async function* streamOf(text: string) {
  yield { content: text };
}

/** 合法对比表格 JSON(未命中模板时的 LLM 回复) */
const TABLE_REPLY = `<thinking>对比</thinking>
{"columns":["维度","自建","采购"],"rows":[["成本","3 人月","年费 12 万"],["工期","3 个月","2 周上线"]]}`;

/**
 * 组装 FlowStateGraph:toolExecutor 桩内嵌真实 ToolRegistry(+真实 TemplateMatcher),
 * 使 template_match 走真实「关键词匹配 + zod 参数契约」链路,其余依赖与 graph.artifact.spec 同款最小桩。
 */
function makeGraph(llmReplies: string[], formRouteKind: string) {
  const replies = [...llmReplies];
  const llmCalls: any[] = [];
  // model-routing-batch:模型桩束提为局部量,供 getModels 与 getModelForTier 共用(共享回复队列与 llmCalls 记录)
  const largeModel = {
    stream: async (messages: any) => {
      llmCalls.push(messages);
      return streamOf(replies.shift() ?? '');
    },
  };
  const flashModel = { stream: async (messages: any) => { llmCalls.push(messages); return streamOf(replies.shift() ?? ''); } };
  const llmFactory = {
    getModels: () => ({
      large: largeModel,
      // model-routing-batch:Auto 路由会把简单请求分到 flash 档,桩束必须包含(与 large 同一桩,共享回复队列)
      flash: flashModel,
      medium: { stream: async () => streamOf(''), invoke: async () => ({ content: '' }) },
    }),
    getMaxOutputTokens: () => 4096,
    // model-routing-batch:graph callLlm 的真实入口按档位取模型(flash 走轻量桩,其余走旗舰桩)
    getModelForTier: (tier: string | undefined) => (tier === 'flash' ? flashModel : largeModel),
  };
  // 真实注册中心 + 真实模板匹配器(validator 工具与本案无关,给最小桩)
  const registry = new ToolRegistry(new TemplateMatcher(), { validate: () => ({ valid: true }) } as never);
  const toolExecutor = {
    execute: async (call: { name: string; params: Record<string, unknown> }) => {
      const r = await registry.execute(call as never);
      return r.ok
        ? { status: 'ok' as const, tool: r.name, data: r.data, message_for_llm: 'ok' }
        : {
            status: 'fail' as const,
            tool: r.name,
            message_for_llm: r.error?.message_for_llm ?? '',
            error_type: r.error?.error_type,
          };
    },
  };
  const graph = new FlowStateGraph(
    { recognize: async () => ({ intent: 'generate', source: 'rule', confidence: 1, reasons: [], llmAttempted: false }) } as never,
    {
      build: (input: any) => ({
        text: `${input.systemPrompt}\n【用户需求】${input.query}`,
        truncated: [],
        segments: {},
        tokenCount: 10,
      }),
    } as never,
    new ReflectionEvaluator(),
    new Rewriter(),
    toolExecutor as never,
    llmFactory as never,
    {
      getSaverName: () => 'memory',
      get: async () => ({ messages: [], lastSummary: undefined }),
      saveTurn: async () => undefined,
      trimMessages: async () => 0,
    } as never,
    { listForSession: async () => [], searchWithMeta: async () => ({ records: [], degraded: [] }) } as never,
    { maybeSummarize: async () => undefined } as never,
    { render: () => '', ingest: () => undefined } as never,
    { whitelist: ['template_match'], getDefinition: () => null } as never,
    {
      route: async () => ({ kind: formRouteKind, source: 'hint', reasons: [], llmAttempted: false }),
    } as never,
  );
  return { graph, llmCalls };
}

describe('全形态模板短路(competitor-driven-evolution-batch Round 13)', () => {
  it.each([
    { kind: 'checklist', query: '帮我生成一个会议待办清单', field: 'checklistDraft', probe: (r: any) => r.checklistDraft.groups.length >= 2 },
    { kind: 'table', query: '做一个技术选型对比', field: 'tableDraft', probe: (r: any) => r.tableDraft.columns.length >= 2 },
    { kind: 'timeline', query: '安排一个三天两晚行程', field: 'timelineDraft', probe: (r: any) => r.timelineDraft.events.length >= 2 },
    { kind: 'mindmap', query: '整理一份读书笔记导图', field: 'mindmapDraft', probe: (r: any) => !!r.mindmapDraft.root },
  ])('① $kind 模板命中 → 秒回 result.$field 且零 LLM 调用', async ({ kind, query, field, probe }) => {
    const { graph, llmCalls } = makeGraph(['<thinking>不该被调用</thinking>{}'], kind);
    const { state } = await graph.run({ threadId: 'ts-1', query, intent: 'generate', formHint: kind as never });
    const result = state.result as any;
    expect(result.kind).toBe('generate');
    expect(result.artifactKind).toBe(kind);
    expect(field in result).toBe(true);
    expect(probe(result)).toBe(true);
    // 短路关键断言:不消耗大模型 token
    expect(llmCalls).toHaveLength(0);
    expect(state.templateMatched).toBe(true);
    expect(state.artifact).toBeDefined();
  });

  it('② 未命中关键词 → 继续走 LLM 生成(既有链路)', async () => {
    const { graph, llmCalls } = makeGraph([TABLE_REPLY], 'table');
    const { state } = await graph.run({
      threadId: 'ts-2',
      query: '帮我对比一下这两个具体方案的利弊',
      intent: 'generate',
      formHint: 'table',
    });
    const result = state.result as any;
    expect(result.artifactKind).toBe('table');
    expect(result.tableDraft.rows.length).toBe(2);
    expect(llmCalls).toHaveLength(1);
    expect(state.templateMatched).toBe(false);
  });

  it('③ 定制词(「要…」)→ 不命中模板,交还 LLM', async () => {
    const { graph, llmCalls } = makeGraph([TABLE_REPLY], 'table');
    const { state } = await graph.run({
      threadId: 'ts-3',
      query: '会议待办清单,但要包含老板汇报这一项',
      intent: 'generate',
      formHint: 'checklist',
    });
    // 定制需求不走模板骨架,由 LLM 按具体内容生成(formHint=checklist 但 LLM 回复为 table 契约时,
    // 解析按 checklist Schema 失败 → Rewriter;此处只断言「未短路」语义)
    expect(llmCalls.length).toBeGreaterThan(0);
    expect(state.templateMatched).toBe(false);
  });

  it('④ flowchart 回归:请假审批模板短路,result 无 artifactKind 字段', async () => {
    const { graph, llmCalls } = makeGraph(['<thinking>不该被调用</thinking>{}'], 'flowchart');
    const { state } = await graph.run({
      threadId: 'ts-4',
      query: '画一个请假审批流程',
      intent: 'generate',
    });
    const result = state.result as any;
    expect(result.kind).toBe('generate');
    // 兼容红线:flowchart 链路 result 不携带 artifactKind 字段
    expect('artifactKind' in result).toBe(false);
    expect(result.flowDraft.nodes.length).toBeGreaterThan(0);
    expect(llmCalls).toHaveLength(0);
    expect(state.templateMatched).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// TemplateMatcher 纯逻辑:形态分库匹配语义
// ---------------------------------------------------------------------------

describe('TemplateMatcher 形态分库(Round 13)', () => {
  const matcher = new TemplateMatcher();

  it('跨形态不误命中:checklist 关键词在 flowchart 库不命中,反之亦然', () => {
    expect(matcher.match('会议待办清单').matched).toBe(false);
    expect(matcher.match('画请假流程', 'checklist').matched).toBe(false);
    expect(matcher.match('会议待办清单', 'checklist').matched).toBe(true);
    expect(matcher.match('画请假流程').matched).toBe(true);
  });

  it('template_match 工具参数契约:非法 artifactKind 被 zod 拒绝', async () => {
    const registry = new ToolRegistry(new TemplateMatcher(), { validate: () => ({ valid: true }) } as never);
    const r = await registry.execute({ name: 'template_match', params: { query: 'x', artifactKind: 'ppt' }, raw: '' });
    expect(r.ok).toBe(false);
    expect(r.error?.error_type).toBe('param');
  });
});
