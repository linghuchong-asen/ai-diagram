// Task 13.4:工具错误分类单测(三级错误 + 代码层重试判定)
import { ToolErrorClassifier } from './error.classifier';

const classifier = new ToolErrorClassifier();

describe('ToolErrorClassifier', () => {
  describe('classify', () => {
    it.each([
      ['ECONNRESET 连接被重置', 'network'],
      ['read ETIMEDOUT 10.0.0.1:443', 'network'],
      ['Request timeout after 30000ms', 'network'],
      ['socket hang up', 'network'],
      ['connect ECONNREFUSED', 'network'],
      ['network error occurred', 'network'],
      ['请求超时，请稍后重试', 'network'],
      ['网络连接异常', 'network'],
    ])('网络类异常应判为 network: %s', (message, expected) => {
      const result = classifier.classify(new Error(message));
      expect(result.error_type).toBe(expected);
      expect(result.status).toBe('error');
      expect(result.suggestion).toBe('code-retry');
      // 网络类不透出原始细节，避免污染提示词
      expect(result.message_for_llm).toBe('工具调用出现网络错误,请稍后重试。');
    });

    it.each([
      ['invalid params: templateId required', 'param'],
      ['参数不合法', 'param'],
      ['schema validation failed', 'param'],
      ['zod parse error', 'param'],
      ['字段格式错误', 'param'],
    ])('参数类异常应判为 param: %s', (message) => {
      const result = classifier.classify(new Error(message));
      expect(result.error_type).toBe('param');
      expect(result.suggestion).toBe('model-correct');
      // param 类保留原始 message，供模型自修正
      expect(result.message_for_llm).toContain(message);
    });

    it('未识别异常兜底为 fail 并建议降级', () => {
      const result = classifier.classify(new Error('something exploded'));
      expect(result.error_type).toBe('fail');
      expect(result.suggestion).toBe('fallback');
      expect(result.message_for_llm).toContain('something exploded');
    });

    it('非 Error 入参也能分类(String 化)', () => {
      expect(classifier.classify('ECONNRESET').error_type).toBe('network');
      expect(classifier.classify({ code: 'oops' }).error_type).toBe('fail');
      expect(classifier.classify(undefined).error_type).toBe('fail');
    });

    it('网络类优先于参数类(含 network 与 param 双关键词时)', () => {
      const result = classifier.classify(new Error('invalid param caused network timeout'));
      expect(result.error_type).toBe('network');
    });
  });

  describe('shouldCodeRetry', () => {
    it('仅 network 允许代码层重试', () => {
      expect(classifier.shouldCodeRetry(classifier.classify(new Error('ETIMEDOUT')))).toBe(true);
    });

    it('param 不重试(交由模型自修正)', () => {
      expect(classifier.shouldCodeRetry(classifier.classify(new Error('invalid params')))).toBe(false);
    });

    it('fail 不重试(直接降级)', () => {
      expect(classifier.shouldCodeRetry(classifier.classify(new Error('boom')))).toBe(false);
    });
  });
});
