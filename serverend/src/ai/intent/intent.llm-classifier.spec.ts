// 语图技术方案 - 意图模型分类器单测(Task 7.2 / 7.4)
// 覆盖:zod 校验通过、非法枚举值拒绝、超时保护、异常不外抛、token 用量抽取
import { IntentLlmClassifier, extractTokenUsage } from './intent.llm-classifier';
import { LlmFactory } from '../adapters/llm.factory';

/** 构造一个只返回固定 medium 模型的假工厂(只读取,不修改适配器) */
function fakeFactory(invokeImpl: (messages: any[]) => Promise<any>) {
  return {
    getModels: () => ({ large: {}, medium: { invoke: invokeImpl }, small: {} }),
  } as unknown as LlmFactory;
}

describe('IntentLlmClassifier(Task 7)', () => {
  it('模型输出纯意图词时解析成功并抽取 usage', async () => {
    const classifier = new IntentLlmClassifier(
      fakeFactory(async () => ({
        content: ' generate\n',
        response_metadata: {
          token_usage: { prompt_tokens: 42, completion_tokens: 1, total_tokens: 43 },
        },
      })),
    );

    const res = await classifier.classify('帮我画个流程', null, 1000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.intent).toBe('generate');
      expect(res.usage).toEqual({ promptTokens: 42, completionTokens: 1, totalTokens: 43 });
    }
  });

  it('模型输出 JSON 时按 zod 契约解析', async () => {
    const classifier = new IntentLlmClassifier(
      fakeFactory(async () => ({
        content: '{"intent":"consult","confidence":0.88,"reason":"疑问句"}',
        usage_metadata: { input_tokens: 20, output_tokens: 8, total_tokens: 28 },
      })),
    );

    const res = await classifier.classify('什么是网关?', null, 1000);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.intent).toBe('consult');
      expect(res.confidence).toBeCloseTo(0.88);
      expect(res.usage).toEqual({ promptTokens: 20, completionTokens: 8, totalTokens: 28 });
    }
  });

  it('模型输出非法枚举值时判定失败(回落由上层处理)', async () => {
    const classifier = new IntentLlmClassifier(fakeFactory(async () => ({ content: '{"intent":"delete_all"}' })));
    const res = await classifier.classify('随便说点什么', null, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('zod 校验失败');
  });

  it('模型输出空内容时判定失败', async () => {
    const classifier = new IntentLlmClassifier(fakeFactory(async () => ({ content: '' })));
    const res = await classifier.classify('?', null, 1000);
    expect(res.ok).toBe(false);
  });

  it('超时时不抛出,返回失败并带原因', async () => {
    const classifier = new IntentLlmClassifier(
      fakeFactory(() => new Promise((resolve) => setTimeout(() => resolve({ content: 'modify' }), 500))),
    );
    const res = await classifier.classify('慢一点的请求', null, 50);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toContain('超时');
  });

  it('模型抛错(含敏感信息)时脱敏后返回失败,绝不外抛', async () => {
    const classifier = new IntentLlmClassifier(
      fakeFactory(async () => {
        throw new Error('connect ECONNREFUSED 10.12.33.44:5432 api_key=sk-abcdefgh12345678');
      }),
    );
    const res = await classifier.classify('任意输入', null, 1000);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).not.toContain('10.12.33.44');
      expect(res.reason).not.toContain('sk-abcdefgh12345678');
    }
  });

  it('extractTokenUsage 对两种结构均可用,缺失时返回 undefined', () => {
    expect(extractTokenUsage({})).toBeUndefined();
    expect(
      extractTokenUsage({ response_metadata: { token_usage: { prompt_tokens: 5, completion_tokens: 3 } } }),
    ).toEqual({ promptTokens: 5, completionTokens: 3, totalTokens: 8 });
    expect(extractTokenUsage({ usage_metadata: { input_tokens: 7, output_tokens: 2 } })).toEqual({
      promptTokens: 7,
      completionTokens: 2,
      totalTokens: 9,
    });
  });
});
