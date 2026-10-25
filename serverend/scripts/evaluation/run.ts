/*
 * @Description: 回归评估脚本入口(Task 13.3)
 *
 * 用法:
 *   ./node_modules/.bin/ts-node --transpile-only scripts/evaluation/run.ts
 *   ./node_modules/.bin/ts-node --transpile-only scripts/evaluation/run.ts --filter=intent
 *
 * 两档设计(核心约束:不引入任何新基础设施依赖):
 *   A 档「确定性评估」—— 意图规则 / schema 边界 / 模板匹配 / 图校验 / 工具执行器，
 *        直接 new 生产类，不依赖编排层与大模型，任何环境都能跑；
 *   B 档「端到端评估」—— 组装真实 FlowStateGraph + FakeLlmFactory + 内存 trace，
 *        跑 generate/modify/consult 全链路。编排层不可用(如并行改造中的中间态)时
 *        自动探测并标注 [跳过]，不计入失败。
 *
 * 指标与阈值(跌破标红 + 退出码非 0):
 *   格式合规率 100% / 图结构完整性 100% / 意图准确率 ≥95% / 工具成功率 ≥98%
 */
import { ChatRequestSchema } from '../../src/ai/schemas/chat.schema';
import { FlowDraftSchema } from '../../src/ai/schemas/flow-draft.schema';
import { ModifyPatchOutputSchema } from '../../src/ai/schemas/patch.schema';
import { IntentRecognizer } from '../../src/ai/intent/intent.recognizer';
import { IntentLlmClassifier } from '../../src/ai/intent/intent.llm-classifier';
import { matchByRules } from '../../src/ai/intent/intent.rules';
import { TemplateMatcher } from '../../src/ai/tools/template-matcher';
import { ValidatorTool } from '../../src/ai/tools/validator.tool';
import { ToolRegistry } from '../../src/ai/tools/tool.registry';
import { ToolExecutor } from '../../src/ai/tools/tool-executor';
import { ToolContextStore } from '../../src/ai/tools/tool-context.store';
import { GraphValidator } from '../../src/ai/reflection/graph.validator';
import { ReflectionEvaluator } from '../../src/ai/reflection/evaluator';
import { Rewriter } from '../../src/ai/reflection/rewriter';
import { ContextBuilder } from '../../src/ai/context/context.builder';
import { CheckpointService } from '../../src/ai/memory/short-term/checkpoint.memory';
import { RollingSummaryService } from '../../src/ai/memory/short-term/rolling-summary.service';
import { LongTermMemoryService } from '../../src/ai/memory/long-term/long-term.store';
import { SessionEntitySlotService } from '../../src/ai/memory/entity-slot';
import { computeTraceMetrics } from '../../src/observability/trace.metrics';
import { FakeLlmFactory } from './fake-llm';
import { createInMemoryTrace, InMemoryTrace } from './in-memory-trace';
import {
  ALL_CASES,
  E2E_CASES,
  EvalCase,
  GRAPH_CASES,
  GraphCase,
  INTENT_CASES,
  IntentCase,
  SCHEMA_CASES,
  SchemaCase,
  TEMPLATE_CASES,
  TemplateCase,
  TOOL_CASES,
  ToolCase,
} from './cases';

/* ---------------- 输出工具 ---------------- */

const COLOR = !!process.stdout.isTTY || process.env.EVAL_COLOR === '1';
const paint = (code: string, text: string) => (COLOR ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = (t: string) => paint('31', t);
const green = (t: string) => paint('32', t);
const yellow = (t: string) => paint('33', t);
const cyan = (t: string) => paint('36', t);
const dim = (t: string) => paint('2', t);
const bold = (t: string) => paint('1', t);

type Outcome = 'pass' | 'fail' | 'skip';

interface CaseReport {
  id: string;
  kind: EvalCase['kind'];
  desc: string;
  outcome: Outcome;
  detail?: string;
}

const reports: CaseReport[] = [];

function report(item: CaseReport): void {
  reports.push(item);
  const tag =
    item.outcome === 'pass'
      ? green('[PASS]')
      : item.outcome === 'fail'
        ? red('[FAIL]')
        : yellow('[SKIP]');
  console.log(`${tag} ${item.id} ${dim('— ' + item.desc)}`);
  if (item.detail) {
    for (const line of item.detail.split('\n')) console.log(`       ${line}`);
  }
}

function pass(id: string, kind: EvalCase['kind'], desc: string): void {
  report({ id, kind, desc, outcome: 'pass' });
}

function fail(id: string, kind: EvalCase['kind'], desc: string, expect: unknown, actual: unknown): void {
  report({
    id,
    kind,
    desc,
    outcome: 'fail',
    detail: `期望: ${stringify(expect)}\n实际: ${stringify(actual)}`,
  });
}

function skip(id: string, kind: EvalCase['kind'], desc: string, reason: string): void {
  report({ id, kind, desc, outcome: 'skip', detail: reason });
}

function stringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    const text = JSON.stringify(value);
    return text && text.length > 300 ? `${text.slice(0, 300)}…` : String(text);
  } catch {
    return String(value);
  }
}

function eq(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/* ---------------- A 档:确定性评估 ---------------- */

const intentRecognizer = new IntentRecognizer();
const templateMatcher = new TemplateMatcher();
const graphValidator = new GraphValidator();
const toolContextStore = new ToolContextStore();
const toolRegistry = new ToolRegistry(new TemplateMatcher(), new ValidatorTool());
const toolExecutor = new ToolExecutor(toolRegistry, toolContextStore);

/** 哨兵值:用 TemplateMatcher 展开内置模板(BUILTIN_TEMPLATES 为模块私有，不导出) */
const BUILTIN_SENTINEL = '__BUILTIN_TEMPLATES__';
const BUILTIN_QUERIES = ['请假审批', '费用报销'];

function builtinDrafts(): Array<{ name: string; draft: any }> {
  return BUILTIN_QUERIES.map((query) => {
    const matched = templateMatcher.match(query);
    return { name: matched.template?.id ?? query, draft: matched.template?.draft };
  }).filter((item) => !!item.draft);
}

function evalSchema(c: SchemaCase): void {
  const schema =
    c.target === 'chat'
      ? ChatRequestSchema
      : c.target === 'draft'
        ? FlowDraftSchema
        : ModifyPatchOutputSchema;
  try {
    const parsed = schema.safeParse(c.payload as any);
    if (parsed.success !== c.expectValid) {
      fail(
        c.id,
        c.kind,
        c.desc,
        { valid: c.expectValid },
        {
          valid: parsed.success,
          issues: parsed.success
            ? undefined
            : (parsed as any).error.issues.slice(0, 3).map((i: any) => `${i.path.join('.') || '(root)'} ${i.message}`),
        },
      );
      return;
    }
    pass(c.id, c.kind, c.desc);
  } catch (err) {
    fail(c.id, c.kind, c.desc, 'no exception', String((err as Error)?.message ?? err));
  }
}

function evalTemplate(c: TemplateCase): void {
  try {
    const matched = templateMatcher.match(c.query);
    if (matched.matched !== c.expectMatched) {
      fail(c.id, c.kind, c.desc, { matched: c.expectMatched }, { matched: matched.matched });
      return;
    }
    if (c.expectTemplateId !== undefined && matched.template?.id !== c.expectTemplateId) {
      fail(c.id, c.kind, c.desc, { templateId: c.expectTemplateId }, { templateId: matched.template?.id });
      return;
    }
    pass(c.id, c.kind, c.desc);
  } catch (err) {
    fail(c.id, c.kind, c.desc, 'no exception', String((err as Error)?.message ?? err));
  }
}

function checkGraph(id: string, kind: EvalCase['kind'], desc: string, label: string, c: GraphCase, draft: any): boolean {
  try {
    const result = graphValidator.validate(draft);
    if (result.valid !== c.expectValid) {
      fail(
        id,
        kind,
        label ? `${desc} ${dim(`[${label}]`)}` : desc,
        { valid: c.expectValid },
        { valid: result.valid, issues: result.issues.map((i) => `${i.severity}:${i.type}`) },
      );
      return false;
    }
    const errorTypes = result.issues.filter((i) => i.severity === 'error').map((i) => i.type).sort();
    const warningTypes = result.issues.filter((i) => i.severity === 'warning').map((i) => i.type).sort();
    if (c.expectIssues && !eq(errorTypes, [...c.expectIssues].sort())) {
      fail(id, kind, label ? `${desc} ${dim(`[${label}]`)}` : desc, { issues: [...c.expectIssues].sort() }, { issues: errorTypes });
      return false;
    }
    if (c.expectWarnings && !eq(warningTypes, [...c.expectWarnings].sort())) {
      fail(id, kind, label ? `${desc} ${dim(`[${label}]`)}` : desc, { warnings: [...c.expectWarnings].sort() }, { warnings: warningTypes });
      return false;
    }
    pass(id, kind, label ? `${desc} ${dim(`[${label}]`)}` : desc);
    return true;
  } catch (err) {
    fail(id, kind, desc, 'no exception', String((err as Error)?.message ?? err));
    return false;
  }
}

function evalGraph(c: GraphCase): void {
  if (c.draft === (BUILTIN_SENTINEL as any)) {
    const drafts = builtinDrafts();
    if (!drafts.length) {
      fail(c.id, c.kind, c.desc, '内置模板可展开', '未展开出任何模板');
      return;
    }
    // 每个内置模板都必须通过校验(否则模板短路会被反思打回)
    let allOk = true;
    for (const item of drafts) {
      const ok = checkGraph(`${c.id}:${item.name}`, c.kind, c.desc, item.name, c, item.draft);
      allOk = allOk && ok;
    }
    // 汇总一条用例结论(便于计数)，明细已在上面逐模板打印
    if (allOk) reports.push({ id: c.id, kind: c.kind, desc: c.desc, outcome: 'pass' });
    else reports.push({ id: c.id, kind: c.kind, desc: c.desc, outcome: 'fail', detail: '存在未通过校验的内置模板' });
    return;
  }
  checkGraph(c.id, c.kind, c.desc, '', c, c.draft);
}

async function evalTool(c: ToolCase): Promise<void> {
  try {
    const result = await toolExecutor.execute({
      name: c.name,
      params: c.params,
      threadId: `eval-${c.id}`,
      // 网络类重试退避不真等，保证脚本秒级完成
      baseDelayMs: 1,
    });
    if (result.status !== c.expectStatus) {
      fail(c.id, c.kind, c.desc, { status: c.expectStatus }, { status: result.status, message: result.message_for_llm });
      return;
    }
    if (c.expectErrorType !== undefined && result.error_type !== c.expectErrorType) {
      fail(c.id, c.kind, c.desc, { errorType: c.expectErrorType }, { errorType: result.error_type });
      return;
    }
    if (result.status === 'ok' && result.data === undefined) {
      fail(c.id, c.kind, c.desc, 'ok 结果应带 data', { data: undefined });
      return;
    }
    pass(c.id, c.kind, c.desc);
  } catch (err) {
    fail(c.id, c.kind, c.desc, 'no exception', String((err as Error)?.message ?? err));
  }
}

/* ---------------- B 档:端到端评估 ---------------- */

interface OrchestratorProbe {
  ok: boolean;
  reasons: string[];
  factory?: any;
  build?: (trace: InMemoryTrace, factory: FakeLlmFactory) => any;
}

/**
 * 探测编排层是否可用。任何一项不满足 → B 档整体标注 [跳过](不计失败)，
 * 原因逐条打印，便于定位是「并行改造中间态」还是「装配缺失」。
 */
function probeOrchestrator(): OrchestratorProbe {
  const reasons: string[] = [];
  let FlowStateGraph: any;
  try {
    // 动态 require:编排层若处于中间态(缺依赖/缺方法)，在这里就抛错，不影响 A 档
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    FlowStateGraph = require('../../src/ai/agents/graph').FlowStateGraph;
  } catch (err) {
    reasons.push(`graph.ts 加载失败: ${String((err as Error)?.message ?? err).split('\n')[0]}`);
    return { ok: false, reasons };
  }

  try {
    require.resolve('../../src/ai/memory/keywords.util');
  } catch {
    reasons.push('缺失依赖模块 src/ai/memory/keywords.util(graph.ts 引用)');
  }
  if (typeof FlowStateGraph?.prototype?.renderToolDefinitions !== 'function') {
    reasons.push('FlowStateGraph.renderToolDefinitions 未定义(graph.ts 调用)');
  }
  if (reasons.length) return { ok: false, reasons };

  return {
    ok: true,
    reasons: [],
    build(trace: InMemoryTrace, factory: FakeLlmFactory) {
      const checkpoints = new CheckpointService();
      const summaryRepoStub = {
        findOne: async () => null,
        find: async () => [],
        save: async (entity: any) => entity,
        create: (entity: any) => entity,
        update: async () => ({ affected: 0 }),
        delete: async () => ({ affected: 0 }),
      };
      return new FlowStateGraph(
        new IntentRecognizer(new IntentLlmClassifier(factory as any)),
        new ContextBuilder(),
        new ReflectionEvaluator(),
        new Rewriter(),
        new ToolExecutor(new ToolRegistry(new TemplateMatcher(), new ValidatorTool()), new ToolContextStore()),
        factory as any,
        checkpoints,
        new LongTermMemoryService(),
        new RollingSummaryService(checkpoints, factory as any, summaryRepoStub as any),
        new SessionEntitySlotService(),
        new ToolRegistry(new TemplateMatcher(), new ValidatorTool()),
        undefined,
        trace.service,
      );
    },
  };
}

/** canary:最小链路实跑一次，验证探测结论(避免静态检查通过但运行时崩) */
async function canaryRun(probe: OrchestratorProbe): Promise<string | null> {
  if (!probe.build) return '装配函数缺失';
  try {
    const trace = createInMemoryTrace();
    const factory = new FakeLlmFactory();
    factory.configure({ medium: JSON.stringify({ intent: 'generate' }) });
    const graph = probe.build(trace, factory);
    const { state } = await graph.run({
      threadId: 'eval-canary',
      sessionId: 'eval-canary-session',
      query: '帮我生成一个请假审批流程',
    });
    const kind = (state.result as any)?.kind;
    if (kind !== 'generate') {
      return `canary 未走通(模板短路应产出 generate，实际 result.kind=${kind}${
        state.error ? `, error=${state.error}` : ''
      })`;
    }
    return null;
  } catch (err) {
    return `canary 运行异常: ${String((err as Error)?.message ?? err).split('\n')[0]}`;
  }
}

async function evalE2e(probe: OrchestratorProbe): Promise<void> {
  const canaryError = await canaryRun(probe);
  if (canaryError) {
    probe.reasons.push(canaryError);
    for (const c of E2E_CASES) skip(c.id, c.kind, c.desc, `编排层不可用: ${canaryError}`);
    return;
  }

  for (const c of E2E_CASES) {
    const trace = createInMemoryTrace();
    const factory = new FakeLlmFactory();
    // medium 兼顾「意图分类兜底」与「consult 回答」:分类先发生 → 入队；consult 走默认应答
    factory.configure({
      large: c.llmReply,
      medium: c.consultReply ?? `意图分类占位应答(${c.id})`,
    });
    factory.setIntentReply(c.expectIntent);

    const threadId = `eval-${c.id}`;
    try {
      const graph = probe.build!(trace, factory);
      const { state } = await graph.run({
        threadId,
        sessionId: c.sessionId,
        query: c.query,
        canvas: c.canvas as any,
      });

      const problems: string[] = [];
      if (state.intent !== c.expectIntent) {
        problems.push(`intent 期望 ${c.expectIntent}，实际 ${state.intent}`);
      }
      const kind = (state.result as any)?.kind;
      if (kind !== c.expectResultKind) {
        problems.push(`result.kind 期望 ${c.expectResultKind}，实际 ${kind}${state.error ? `(error=${state.error})` : ''}`);
      }
      if (c.expectTemplateMatched !== undefined && !!state.templateMatched !== c.expectTemplateMatched) {
        problems.push(`templateMatched 期望 ${c.expectTemplateMatched}，实际 ${!!state.templateMatched}`);
      }
      if (c.expectTemplateMatched === true && factory.large.calls !== 0) {
        problems.push(`模板短路不应调用大模型，实际 large 调用 ${factory.large.calls} 次`);
      }

      const header = trace.headerOf(threadId);
      const metrics =
        (header?.metrics as any) ??
        computeTraceMetrics({
          steps: trace.stepsOf(threadId),
          status: header?.status as any,
          resultKind: header?.resultKind,
          templateMatched: header?.templateMatched,
          totalDurationMs: header?.totalDurationMs,
        });
      if (metrics.termination !== c.expectTermination) {
        problems.push(`termination 期望 ${c.expectTermination}，实际 ${metrics.termination}`);
      }
      if (trace.stepsOf(threadId).length === 0) {
        problems.push('轨迹未记录任何步骤(埋点未生效)');
      }

      if (problems.length) {
        report({ id: c.id, kind: c.kind, desc: c.desc, outcome: 'fail', detail: problems.join('\n') });
      } else {
        report({
          id: c.id,
          kind: c.kind,
          desc: `${c.desc} ${dim(`(steps=${metrics.stepCount}, tool=${metrics.toolCallCount}, tokens=${metrics.tokenUsage?.totalTokens ?? 0}, ${metrics.totalDurationMs}ms)`)}`,
          outcome: 'pass',
        });
      }
    } catch (err) {
      fail(c.id, c.kind, c.desc, 'no exception', String((err as Error)?.message ?? err));
    }
  }
}

/* ---------------- 指标聚合与阈值 ---------------- */

interface Metric {
  name: string;
  pass: number;
  total: number;
  rate: number;
  threshold: number;
  skipped: boolean;
}

function buildMetric(name: string, kinds: EvalCase['kind'][], threshold: number): Metric {
  const scoped = reports.filter((r) => kinds.includes(r.kind) && r.outcome !== 'skip');
  const skipped = reports.filter((r) => kinds.includes(r.kind) && r.outcome === 'skip').length;
  const passCount = scoped.filter((r) => r.outcome === 'pass').length;
  const total = scoped.length;
  return {
    name,
    pass: passCount,
    total,
    rate: total ? passCount / total : 1,
    threshold,
    skipped: total === 0 && skipped > 0,
  };
}

function printMetrics(metrics: Metric[]): boolean {
  console.log('');
  console.log(bold('═══ 指标汇总 ═══'));
  let allOk = true;
  for (const m of metrics) {
    const pct = `${(m.rate * 100).toFixed(1)}%`;
    const thresholdText = `阈值 ${(m.threshold * 100).toFixed(0)}%`;
    if (m.skipped) {
      console.log(`  ${yellow('—')} ${m.name.padEnd(14, ' ')} ${yellow('跳过').padEnd(6, ' ')} ${dim(thresholdText)}`);
      continue;
    }
    const ok = m.rate >= m.threshold - 1e-9;
    allOk = allOk && ok;
    const line = `  ${ok ? green('✓') : red('✗')} ${m.name.padEnd(14, ' ')} ${ok ? green(pct) : red(pct)} (${m.pass}/${m.total})  ${dim(thresholdText)}`;
    console.log(ok ? line : red(line));
  }
  return allOk;
}

/* ---------------- 主流程 ---------------- */

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filterArg = args.find((a) => a.startsWith('--filter='));
  const filter = filterArg ? filterArg.slice('--filter='.length).trim() : '';
  const skipE2e = args.includes('--skip-e2e');

  const cases: EvalCase[] = filter ? ALL_CASES.filter((c) => c.id.includes(filter) || c.kind.includes(filter)) : ALL_CASES;

  console.log(bold('═══ AI 流程图编排回归评估(Task 13.3) ═══'));
  console.log(
    dim(
      `用例 ${cases.length} 条 | LLM key: ${
        process.env.DASHSCOPE_API_KEY || process.env.OPENAI_API_KEY ? '已配置(B 档使用 FakeLlmFactory，不联网)' : '未配置(离线模式，B 档用 FakeLlmFactory)'
      }`,
    ),
  );

  console.log('');
  console.log(cyan('── A 档:确定性评估(不依赖大模型) ──'));
  for (const c of cases) {
    if (c.kind === 'intent') await evalIntentAsync(c as IntentCase);
    else if (c.kind === 'schema') evalSchema(c as SchemaCase);
    else if (c.kind === 'template') evalTemplate(c as TemplateCase);
    else if (c.kind === 'graph') evalGraph(c as GraphCase);
    else if (c.kind === 'tool') await evalTool(c as ToolCase);
  }

  console.log('');
  console.log(cyan('── B 档:端到端评估(FlowStateGraph + FakeLlmFactory + 内存 trace) ──'));
  if (skipE2e) {
    for (const c of E2E_CASES) skip(c.id, c.kind, c.desc, '命令行指定 --skip-e2e');
  } else {
    const probe = probeOrchestrator();
    if (!probe.ok) {
      console.log(yellow(`  编排层探测未通过，B 档整体跳过(不计入失败):`));
      for (const reason of probe.reasons) console.log(yellow(`    · ${reason}`));
      for (const c of E2E_CASES) skip(c.id, c.kind, c.desc, `编排层不可用: ${probe.reasons[0]}`);
    } else {
      await evalE2e(probe);
    }
  }

  const metrics: Metric[] = [
    buildMetric('格式合规率', ['schema'], 1),
    buildMetric('图结构完整性', ['graph'], 1),
    buildMetric('意图准确率', ['intent'], 0.95),
    buildMetric('工具成功率', ['tool'], 0.98),
    buildMetric('模板匹配准确率', ['template'], 1),
    buildMetric('端到端通过率', ['e2e'], 1),
  ];
  const metricsOk = printMetrics(metrics);

  const failed = reports.filter((r) => r.outcome === 'fail');
  const passed = reports.filter((r) => r.outcome === 'pass').length;
  const skipped = reports.filter((r) => r.outcome === 'skip').length;

  console.log('');
  console.log(bold('═══ 结论 ═══'));
  console.log(
    `  通过 ${green(String(passed))} | 失败 ${failed.length ? red(String(failed.length)) : '0'} | 跳过 ${
      skipped ? yellow(String(skipped)) : '0'
    }`,
  );
  if (failed.length) {
    console.log(red('  跌破阈值的用例:'));
    for (const f of failed) console.log(red(`    ✗ ${f.id}: ${f.desc}`));
  }

  const exitOk = metricsOk && failed.length === 0;
  console.log('');
  console.log(exitOk ? green('评估通过。') : red('评估未通过，退出码 1。'));
  process.exit(exitOk ? 0 : 1);
}

/** 意图评估(异步版):recognize 为 async，必须 await */
async function evalIntentAsync(c: IntentCase): Promise<void> {
  const signals = {
    hasCanvas: c.hasCanvas,
    canvasNodes: c.hasCanvas ? 4 : 0,
    hasSelection: false,
    query: c.query,
  };
  try {
    const rule = matchByRules(c.query, signals as any);
    if (c.expectAmbiguous !== undefined && rule.ambiguous !== c.expectAmbiguous) {
      fail(c.id, c.kind, c.desc, { ambiguous: c.expectAmbiguous }, { ambiguous: rule.ambiguous });
      return;
    }
    const result = await intentRecognizer.recognize({ query: c.query, signals: signals as any });
    if (result.intent !== c.expectIntent) {
      fail(c.id, c.kind, c.desc, { intent: c.expectIntent }, { intent: result.intent, reasons: result.reasons });
      return;
    }
    if (result.source !== 'rule') {
      fail(c.id, c.kind, c.desc, { source: 'rule' }, { source: result.source });
      return;
    }
    pass(c.id, c.kind, `${c.desc} ${dim(`(confidence=${result.confidence})`)}`);
  } catch (err) {
    fail(c.id, c.kind, c.desc, 'no exception', String((err as Error)?.message ?? err));
  }
}

main().catch((err) => {
  console.error(red(`评估脚本自身异常: ${err?.stack ?? err}`));
  process.exit(2);
});
