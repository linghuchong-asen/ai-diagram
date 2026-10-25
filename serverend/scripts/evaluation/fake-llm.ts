/*
 * @Description: 评估脚本专用的假模型工厂(Task 13.3)
 *
 * 目的:让端到端评估「不依赖真实大模型 key」也能跑完整编排链路。
 * 契约与 graph.ts 的真实消费方式对齐:
 *   - callLlm / runConsult 使用 `await llm.stream(messages)` + `for await (chunk of stream)` 读 chunk.content
 *   - IntentLlmClassifier.classify 使用 `medium.invoke([system, user])` 读 response.content / response.text
 * 因此 FakeModel 只需实现这两个入口。
 */
import { LlmFactory, LlmModelBundle } from '../../src/ai/adapters/llm.factory';

/** 一条模型应答 */
export interface FakeReply {
  /** 应答文本(stream 会按此切片逐块吐出) */
  text: string;
  /** stream 分片数，默认 1 */
  chunks?: number;
}

/** 按档位配置应答 */
export interface FakeReplies {
  /** large:generate / modify 产出 */
  large?: FakeReply | string;
  /** medium:consult 回答 + 意图分类兜底 */
  medium?: FakeReply | string;
  /** small:预留 */
  small?: FakeReply | string;
}

function normalize(reply?: FakeReply | string): FakeReply | undefined {
  if (reply === undefined || reply === null) return undefined;
  return typeof reply === 'string' ? { text: reply } : reply;
}

/** 假模型:实现 stream / invoke 两个真实被消费的入口 */
export class FakeModel {
  /** 本档位的应答队列，按调用顺序出队；耗尽后回落 defaultReply */
  private readonly queue: FakeReply[] = [];
  private defaultReply: FakeReply | undefined;
  /** 调用次数，便于断言「模板短路不消耗 token」 */
  calls = 0;

  constructor(public readonly tier: string) {}

  setDefault(reply?: FakeReply | string): this {
    this.defaultReply = normalize(reply);
    return this;
  }

  enqueue(reply?: FakeReply | string): this {
    const normalized = normalize(reply);
    if (normalized) this.queue.push(normalized);
    return this;
  }

  reset(): this {
    this.queue.length = 0;
    this.calls = 0;
    return this;
  }

  private next(): string {
    this.calls++;
    const reply = this.queue.shift() ?? this.defaultReply;
    return reply?.text ?? '';
  }

  /** graph.callLlm / runConsult 走这里 */
  async stream(_messages: unknown): Promise<AsyncGenerator<{ content: string }>> {
    const text = this.next();
    const chunks = Math.max(1, _normalizeChunkCount(text));
    return (async function* () {
      const size = Math.ceil(text.length / chunks) || 1;
      for (let i = 0; i < text.length; i += size) {
        yield { content: text.slice(i, i + size) };
      }
    })();
  }

  /** IntentLlmClassifier.classify 走这里 */
  async invoke(_messages: unknown): Promise<{ content: string; text: string }> {
    const text = this.next();
    return { content: text, text };
  }
}

function _normalizeChunkCount(text: string): number {
  if (!text) return 1;
  return text.length > 400 ? 4 : 1;
}

/**
 * 假工厂:继承真实 LlmFactory 以保持类型兼容(graph 构造器要求 LlmFactory)，
 * 但覆写 getModels / isAvailable，绝不触碰真实 ConfigService 与网络。
 */
export class FakeLlmFactory extends LlmFactory {
  readonly large = new FakeModel('large');
  readonly medium = new FakeModel('medium');
  readonly small = new FakeModel('small');
  /* 不复用基类私有字段名 bundle，避免 TS2415(私有属性重复声明) */
  private readonly fakeBundle: LlmModelBundle;

  constructor() {
    // 父类构造只保存 config 引用，不会触发任何读取
    super({ get: () => undefined } as any);
    this.fakeBundle = { large: this.large as any, medium: this.medium as any, small: this.small as any };
  }

  override getModels(): LlmModelBundle {
    return this.fakeBundle;
  }

  override isAvailable(): boolean {
    return true;
  }

  override getApiKey(): string | null {
    return 'fake-eval-key';
  }

  override getUnavailableReason(): string | null {
    return null;
  }

  /** 按用例配置三档应答 */
  configure(replies: FakeReplies): this {
    this.large.reset().setDefault(replies.large);
    this.medium.reset().setDefault(replies.medium);
    this.small.reset().setDefault(replies.small);
    return this;
  }

  /** 意图分类应答:分类器要求 JSON {intent} 结构 */
  setIntentReply(intent: string): this {
    this.medium.enqueue(JSON.stringify({ intent }));
    return this;
  }

  totalCalls(): number {
    return this.large.calls + this.medium.calls + this.small.calls;
  }
}
