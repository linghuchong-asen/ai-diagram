// Task 13.4:轨迹指标聚合单测(纯函数,不依赖数据库)
import {
  computeTraceMetrics,
  resolveTermination,
  CONTEXT_TOKEN_BUDGET,
  MetricsInput,
} from './trace.metrics';
import { TRACE_STEPS, TraceStepRecord } from './trace.types';

let seq = 0;

function step(partial: Partial<TraceStepRecord> = {}): TraceStepRecord {
  seq += 1;
  return {
    seq,
    stepName: TRACE_STEPS.RUN,
    status: 'ok',
    durationMs: 10,
    ...partial,
  } as TraceStepRecord;
}

beforeEach(() => {
  seq = 0;
});

describe('computeTraceMetrics', () => {
  it('空步骤列表:零指标且成功率记为 1(无失败可言)', () => {
    const metrics = computeTraceMetrics({ steps: [] });
    expect(metrics.toolCallCount).toBe(0);
    expect(metrics.toolCallOkCount).toBe(0);
    expect(metrics.toolCallSuccessRate).toBe(1);
    expect(metrics.stepCount).toBe(0);
    expect(metrics.contextUtilization).toBe(0);
    expect(metrics.termination).toBe('incomplete');
  });

  it('steps 为 undefined 时不抛错', () => {
    const metrics = computeTraceMetrics(undefined as unknown as MetricsInput);
    expect(metrics.stepCount).toBe(0);
  });

  it('工具调用次数/成功率/按名细分', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.TOOL_CALL, meta: { tool: 'template_match' } }),
        step({ stepName: TRACE_STEPS.TOOL_CALL, status: 'fail', meta: { tool: 'validate_graph' } }),
        step({ stepName: TRACE_STEPS.TOOL_CALL, meta: { tool: 'validate_graph' } }),
        step({ stepName: TRACE_STEPS.INTENT }),
      ],
    });
    expect(metrics.toolCallCount).toBe(3);
    expect(metrics.toolCallOkCount).toBe(2);
    expect(metrics.toolCallSuccessRate).toBeCloseTo(0.667, 3);
    expect(metrics.toolCallsByName).toEqual({ template_match: 1, validate_graph: 2 });
    // 非工具步骤不计入工具指标
    expect(metrics.stepCount).toBe(4);
  });

  it('工具步骤缺 meta.tool 时归入 unknown', () => {
    const metrics = computeTraceMetrics({ steps: [step({ stepName: TRACE_STEPS.TOOL_CALL })] });
    expect(metrics.toolCallsByName).toEqual({ unknown: 1 });
  });

  it('反思回路次数 = 未通过次数，通过次数单独统计', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.REFLECTION, status: 'fail' }),
        step({ stepName: TRACE_STEPS.REWRITE }),
        step({ stepName: TRACE_STEPS.REFLECTION, status: 'fail' }),
        step({ stepName: TRACE_STEPS.REWRITE }),
        step({ stepName: TRACE_STEPS.REFLECTION }),
      ],
    });
    expect(metrics.reflectionLoopCount).toBe(2);
    expect(metrics.reflectionPassCount).toBe(1);
  });

  it('LLM 调用次数含 generate 与 consult', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.GENERATE }),
        step({ stepName: TRACE_STEPS.GENERATE }),
        step({ stepName: TRACE_STEPS.CONSULT }),
      ],
    });
    expect(metrics.llmCallCount).toBe(3);
  });

  it('错误恢复步数:fail 之后仍有 ok 才计数', () => {
    const recovered = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.GENERATE, status: 'fail' }),
        step({ stepName: TRACE_STEPS.GENERATE }),
      ],
    });
    expect(recovered.errorRecoverySteps).toBe(1);

    const notRecovered = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.GENERATE }),
        step({ stepName: TRACE_STEPS.GENERATE, status: 'fail' }),
      ],
    });
    expect(notRecovered.errorRecoverySteps).toBe(0);
  });

  it('skipped 步骤不计入错误恢复', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.TOOL_CALL, status: 'fail' }),
        step({ stepName: TRACE_STEPS.TOOL_CALL, status: 'skipped' }),
      ],
    });
    expect(metrics.errorRecoverySteps).toBe(0);
  });

  it('上下文利用率取最后一次 context.build 的 tokenCount / 预算', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 1000 } }),
        step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 2560 } }),
      ],
    });
    expect(metrics.contextBudget).toBe(CONTEXT_TOKEN_BUDGET);
    expect(metrics.contextTokens).toBe(2560);
    expect(metrics.contextUtilization).toBeCloseTo(0.1, 3);
  });

  it('上下文利用率封顶为 1，且支持自定义预算', () => {
    const metrics = computeTraceMetrics({
      steps: [step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 99999 } })],
      contextBudget: 100,
    });
    expect(metrics.contextUtilization).toBe(1);
    expect(metrics.contextBudget).toBe(100);
  });

  it('预算为 0 时利用率记 0(避免除零)', () => {
    const metrics = computeTraceMetrics({
      steps: [step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 10 } })],
      contextBudget: 0,
    });
    expect(metrics.contextUtilization).toBe(0);
  });

  it('截断区块归一为字符串数组，非法值退化为空数组', () => {
    const withTruncated = computeTraceMetrics({
      steps: [step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 1, truncated: ['recentTurns', 'retrieved'] } })],
    });
    expect(withTruncated.contextTruncated).toEqual(['recentTurns', 'retrieved']);

    const without = computeTraceMetrics({
      steps: [step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount: 1, truncated: 'recentTurns' } })],
    });
    expect(without.contextTruncated).toEqual([]);
  });

  it('非法 tokenCount(负数/NaN/字符串)按 0 处理', () => {
    for (const tokenCount of [-5, Number.NaN, 'abc', undefined]) {
      const metrics = computeTraceMetrics({
        steps: [step({ stepName: TRACE_STEPS.CONTEXT, meta: { tokenCount } })],
      });
      expect(metrics.contextTokens).toBe(0);
    }
  });

  it('总耗时优先取入参，缺省时由步骤累加', () => {
    const fromInput = computeTraceMetrics({
      steps: [step({ durationMs: 100 }), step({ durationMs: 50 })],
      totalDurationMs: 999,
    });
    expect(fromInput.totalDurationMs).toBe(999);

    const fromSteps = computeTraceMetrics({
      steps: [step({ durationMs: 100 }), step({ durationMs: 50 })],
    });
    expect(fromSteps.totalDurationMs).toBe(150);
  });

  it('按步骤名累加耗时', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ stepName: TRACE_STEPS.GENERATE, durationMs: 100 }),
        step({ stepName: TRACE_STEPS.GENERATE, durationMs: 30 }),
        step({ stepName: TRACE_STEPS.INTENT, durationMs: 5 }),
      ],
    });
    expect(metrics.durationByStep[TRACE_STEPS.GENERATE]).toBe(130);
    expect(metrics.durationByStep[TRACE_STEPS.INTENT]).toBe(5);
  });

  it('token 用量跨步骤累加', () => {
    const metrics = computeTraceMetrics({
      steps: [
        step({ usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 } }),
        step({ usage: { promptTokens: 20, completionTokens: 7, totalTokens: 27 } }),
        step({}),
      ],
    });
    expect(metrics.tokenUsage).toEqual({ promptTokens: 30, completionTokens: 12, totalTokens: 42 });
  });

  it('步骤乱序传入时按 seq 重排后计算(不影响终止条件推断)', () => {
    const metrics = computeTraceMetrics({
      steps: [
        { seq: 2, stepName: TRACE_STEPS.GENERATE, status: 'ok', durationMs: 1 },
        { seq: 1, stepName: TRACE_STEPS.GENERATE, status: 'fail', durationMs: 1 },
      ],
    });
    expect(metrics.errorRecoverySteps).toBe(1);
    expect(metrics.termination).toBe('incomplete');
  });
});

describe('resolveTermination', () => {
  it('status=error 优先于其它信号', () => {
    expect(resolveTermination({ steps: [], status: 'error', templateMatched: true }, [])).toBe('error');
  });

  it('status=suspended → 人在回路挂起', () => {
    expect(resolveTermination({ steps: [], status: 'suspended' }, [])).toBe('suspended_human_confirm');
  });

  it('模板命中 → 短路终止', () => {
    expect(resolveTermination({ steps: [], status: 'ok', templateMatched: true, resultKind: 'generate' }, [])).toBe(
      'template_shortcut',
    );
  });

  it('consult 结果 → 咨询直接回答', () => {
    expect(resolveTermination({ steps: [], status: 'ok', resultKind: 'consult' }, [])).toBe('consult_answer');
  });

  it.each(['generate', 'modify'])('%s 结果 → 通过校验的有效产出', (kind) => {
    expect(resolveTermination({ steps: [], status: 'ok', resultKind: kind }, [])).toBe('valid_result');
  });

  it('status=ok 但缺 resultKind 时保守判为咨询回答', () => {
    expect(resolveTermination({ steps: [], status: 'ok' }, [])).toBe('consult_answer');
  });

  it('未收尾且最后一步为挂起步骤 → 人在回路', () => {
    const steps = [step({ stepName: TRACE_STEPS.HUMAN_CONFIRM })];
    expect(resolveTermination({ steps, status: 'running' }, steps)).toBe('suspended_human_confirm');
  });

  it('未收尾且最后一步失败 → error', () => {
    const steps = [step({ stepName: TRACE_STEPS.GENERATE, status: 'fail' })];
    expect(resolveTermination({ steps, status: 'running' }, steps)).toBe('error');
  });

  it('未收尾且最后一步正常 → incomplete(进程中断)', () => {
    const steps = [step({ stepName: TRACE_STEPS.PERSIST })];
    expect(resolveTermination({ steps }, steps)).toBe('incomplete');
  });

  it('空轨迹 → incomplete', () => {
    expect(resolveTermination({ steps: [] }, [])).toBe('incomplete');
  });
});
