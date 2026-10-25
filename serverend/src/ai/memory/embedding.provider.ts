// 语图技术方案 - 可插拔 Embedding Provider(Task 10.2)
// 文档(memory.md):长期记忆 = 摘要 + 向量 + 关键词;双路召回需要向量。
// 约束:不引入新基础设施依赖 —— 当前环境无 pgvector,向量以 jsonb 存储,
//       取有界候选集后在 JS 内计算余弦相似度(见 long-term/pg.store.ts)。
// 默认实现:走 LLM adapter 的 OpenAI 兼容 embedding 接口(@langchain/openai OpenAIEmbeddings)。
// 降级:无密钥 / 调用异常时标记 unavailable,长期记忆自动退化为关键词单路,并记录降级原因。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LlmFactory } from '../adapters/llm.factory';

export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-v3';
/** embedding 调用超时:旁路能力,不允许拖慢主链路 */
const EMBED_TIMEOUT_MS = 8000;
/** 单批最多嵌入文本数 */
const EMBED_BATCH_SIZE = 16;
/** 单条文本最大字符数(超出截断,避免超额消耗) */
const EMBED_TEXT_MAX_CHARS = 2000;

/** 降级信息:写入日志并透出到 trace 字段 */
export interface EmbeddingDegradation {
  reason: string;
  at: number;
}

export interface EmbeddingProvider {
  readonly name: string;
  /** 是否可用(无密钥/连续失败时为 false) */
  available(): boolean;
  /** 最近一次不可用原因 */
  unavailableReason(): string | null;
  /** 单条文本向量;不可用或失败返回 null(调用方退化单路) */
  embedQuery(text: string): Promise<number[] | null>;
  /** 批量文本向量,顺序与入参一致;不可用时返回全 null */
  embedDocuments(texts: string[]): Promise<Array<number[] | null>>;
}

/** 始终不可用的空实现:测试与"无密钥"环境使用 */
export class NullEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'null';

  constructor(private readonly reason = 'embedding 未启用') {}

  available(): boolean {
    return false;
  }

  unavailableReason(): string | null {
    return this.reason;
  }

  async embedQuery(): Promise<number[] | null> {
    return null;
  }

  async embedDocuments(texts: string[]): Promise<Array<number[] | null>> {
    return (texts ?? []).map(() => null);
  }
}

/** OpenAI 兼容 embedding(DashScope / OpenAI),复用 LLM adapter 的密钥与 baseURL */
export class OpenAiCompatibleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai-compatible';
  private readonly logger = new Logger(OpenAiCompatibleEmbeddingProvider.name);
  private client: any = null;
  private disabledReason: string | null = null;
  /** 连续失败计数:达到阈值后熔断,避免每轮都打一次无效请求 */
  private consecutiveFailures = 0;

  constructor(
    private readonly options: {
      apiKey: string | null;
      baseURL: string;
      model: string;
    },
  ) {
    if (!options.apiKey) {
      this.disabledReason = '缺少 DASHSCOPE_API_KEY / OPENAI_API_KEY,embedding 不可用';
    }
  }

  available(): boolean {
    return this.disabledReason === null;
  }

  unavailableReason(): string | null {
    return this.disabledReason;
  }

  async embedQuery(text: string): Promise<number[] | null> {
    const vectors = await this.embedDocuments([text]);
    return vectors[0] ?? null;
  }

  async embedDocuments(texts: string[]): Promise<Array<number[] | null>> {
    const list = (texts ?? []).map((t) => (t ?? '').slice(0, EMBED_TEXT_MAX_CHARS));
    if (list.length === 0 || !this.available()) return list.map(() => null);

    const client = await this.getClient();
    if (!client) return list.map(() => null);

    try {
      const vectors: Array<number[] | null> = [];
      for (let i = 0; i < list.length; i += EMBED_BATCH_SIZE) {
        const batch = list.slice(i, i + EMBED_BATCH_SIZE).filter((t) => t.trim().length > 0);
        if (batch.length === 0) continue;
        const result = (await withTimeout(client.embedDocuments(batch), EMBED_TIMEOUT_MS)) as number[][];
        for (const v of result ?? []) vectors.push(Array.isArray(v) ? v.map(Number) : null);
      }
      this.consecutiveFailures = 0;
      // 批量过滤后长度可能与入参不一致,这里按入参长度补齐 null
      while (vectors.length < list.length) vectors.push(null);
      return vectors.slice(0, list.length);
    } catch (err) {
      this.consecutiveFailures++;
      const reason = `embedding 调用失败(${this.consecutiveFailures} 次): ${(err as Error)?.message ?? 'unknown'}`;
      this.logger.warn(`${reason};长期记忆向量路降级为关键词单路`);
      if (this.consecutiveFailures >= 3) {
        // 连续失败视为环境不具备 embedding 能力:熔断并记录降级原因
        this.disabledReason = reason;
      }
      return list.map(() => null);
    }
  }

  private async getClient(): Promise<any> {
    if (this.client) return this.client;
    try {
      // 动态 require:@langchain/openai 已是既有依赖,此处仅按需加载 embeddings 子模块
      const { OpenAIEmbeddings } = await import('@langchain/openai');
      this.client = new OpenAIEmbeddings({
        model: this.options.model,
        apiKey: this.options.apiKey as string,
        configuration: { baseURL: this.options.baseURL },
        timeout: EMBED_TIMEOUT_MS,
        batchSize: EMBED_BATCH_SIZE,
      });
      return this.client;
    } catch (err) {
      this.disabledReason = `embedding 客户端初始化失败: ${(err as Error)?.message ?? 'unknown'}`;
      this.logger.warn(this.disabledReason);
      return null;
    }
  }
}

/** 装配入口:根据环境变量选择实现(默认 OpenAI 兼容;EMBEDDING_PROVIDER=null 显式关闭) */
@Injectable()
export class EmbeddingProviderFactory {
  constructor(
    private readonly config: ConfigService,
    private readonly llmFactory: LlmFactory,
  ) {}

  create(): EmbeddingProvider {
    const kind = (this.config.get('EMBEDDING_PROVIDER') || 'openai').toLowerCase();
    if (kind === 'null' || kind === 'none' || kind === 'off') {
      return new NullEmbeddingProvider('EMBEDDING_PROVIDER 已显式关闭');
    }
    return new OpenAiCompatibleEmbeddingProvider({
      apiKey: this.llmFactory.getApiKey(),
      baseURL: this.llmFactory.getBaseUrl(),
      model: this.config.get('EMBEDDING_MODEL') || DEFAULT_EMBEDDING_MODEL,
    });
  }
}

/** 进程内单例持有者:便于长期记忆服务与写入侧共用同一 provider(共享熔断状态) */
export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER_INSTANCE';

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`embedding 超时(${ms}ms)`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
