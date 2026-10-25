// 语图技术方案 - 意图识别单测(Task 7.4)
// 覆盖三条关键路径:
//   ① 规则确定命中 → 不调用模型(source='rule', llmAttempted=false)
//   ② 歧义 / 未命中 → 调用模型兜底(source='llm', 附 usage)
//   ③ 模型输出非法 / 兜底失败 → 回落规则并记录原因(source='rule', reasons 含失败原因)
import { IntentRecognizer } from './intent.recognizer';
import { IntentLlmClassifier, IntentClassifyResult } from './intent.llm-classifier';
import { matchByRules, ContextSignals } from './intent.rules';

/** 最小 fake:只替换 classify,避免依赖真实 LlmFactory / 网络 */
function fakeClassifier(result: IntentClassifyResult, spy?: { calls: number; lastQuery?: string }) {
  return {
    async classify(query: string) {
      if (spy) {
        spy.calls += 1;
        spy.lastQuery = query;
      }
      return result;
    },
  } as unknown as IntentLlmClassifier;
}

const NO_CANVAS: ContextSignals = { hasCanvas: false, canvasNodes: 0, hasSelection: false, query: '' };
const WITH_CANVAS: ContextSignals = { hasCanvas: true, canvasNodes: 4, hasSelection: false, query: '' };

describe('IntentRecognizer(Task 7)', () => {
  it('① 规则确定命中时不调用模型,source 为 rule', async () => {
    const spy = { calls: 0 };
    const recognizer = new IntentRecognizer(
      fakeClassifier({ ok: true, intent: 'consult', confidence: 0.9, reason: '不应被调用' }, spy),
    );

    // "帮我画一个请假审批流程" 只命中 generate 动词,单一意图 → 非歧义
    const res = await recognizer.recognize({ query: '帮我画一个请假审批流程图', signals: NO_CANVAS });

    expect(res.intent).toBe('generate');
    expect(res.source).toBe('rule');
    expect(res.llmAttempted).toBe(false);
    expect(res.usage).toBeUndefined();
    expect(spy.calls).toBe(0);
  });

  it('② 规则未命中(无动词特征)时调用模型兜底,source 为 llm 并带 usage', async () => {
    const spy = { calls: 0 };
    const recognizer = new IntentRecognizer(
      fakeClassifier(
        {
          ok: true,
          intent: 'consult',
          confidence: 0.82,
          reason: '模型分类',
          usage: { promptTokens: 30, completionTokens: 2, totalTokens: 32 },
        },
        spy,
      ),
    );

    // 该问句不含任何规则动词特征(无"怎么/如何/画/改"等) → 规则未命中,必须走模型兜底
    const res = await recognizer.recognize({ query: '这块业务到底该从哪儿着手比较好呢', signals: NO_CANVAS });

    expect(spy.calls).toBe(1);
    expect(res.intent).toBe('consult');
    expect(res.source).toBe('llm');
    expect(res.confidence).toBeCloseTo(0.82);
    expect(res.usage).toEqual({ promptTokens: 30, completionTokens: 2, totalTokens: 32 });
    expect(res.llmAttempted).toBe(true);
  });

  it('②-b 多规则命中(歧义)时也走模型兜底', async () => {
    const spy = { calls: 0 };
    const rule = matchByRules('把刚才的流程改一下再画一张新的', WITH_CANVAS);
    expect(rule.ambiguous).toBe(true);
    expect(rule.hitIntents.length).toBeGreaterThan(1);

    const recognizer = new IntentRecognizer(
      fakeClassifier({ ok: true, intent: 'modify', confidence: 0.9, reason: '画布已有内容' }, spy),
    );
    const res = await recognizer.recognize({ query: '把刚才的流程改一下再画一张新的', signals: WITH_CANVAS });

    expect(spy.calls).toBe(1);
    expect(res.intent).toBe('modify');
    expect(res.source).toBe('llm');
  });

  it('③ 模型返回非法值时回落规则,source 仍为 rule 且记录原因', async () => {
    const spy = { calls: 0 };
    const recognizer = new IntentRecognizer(
      fakeClassifier({ ok: false, reason: '模型输出不含合法意图枚举(generate|modify|consult)' }, spy),
    );

    const res = await recognizer.recognize({ query: '这块业务到底该从哪儿着手比较好呢', signals: NO_CANVAS });

    expect(spy.calls).toBe(1);
    expect(res.source).toBe('rule');
    expect(res.usage).toBeUndefined();
    expect(res.reasons.join(' | ')).toContain('模型兜底失败,回落规则');
  });

  it('③-b 模型兜底抛错/超时时不向上抛出,回落规则', async () => {
    const throwing = {
      async classify(): Promise<IntentClassifyResult> {
        return { ok: false, reason: '意图模型兜底失败: 意图分类模型调用超时(6000ms)' };
      },
    } as unknown as IntentLlmClassifier;

    const recognizer = new IntentRecognizer(throwing);
    await expect(recognizer.recognize({ query: '帮我画一个报销流程', signals: NO_CANVAS })).resolves.toBeDefined();

    const res = await recognizer.recognize({ query: '帮我画一个报销流程', signals: NO_CANVAS });
    expect(res.intent).toBe('generate');
    expect(res.source).toBe('rule');
  });

  it('④ 未注入分类器时走内置启发式,source 标记为 rule(不再虚假标 llm)', async () => {
    const recognizer = new IntentRecognizer();
    const res = await recognizer.recognize({ query: '为什么要加人事备案节点?', signals: WITH_CANVAS });
    expect(res.source).toBe('rule');
    expect(['consult', 'modify', 'generate']).toContain(res.intent);
  });
});
