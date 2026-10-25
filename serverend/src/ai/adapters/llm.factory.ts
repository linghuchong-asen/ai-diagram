// 语图技术方案 - 模型分层工厂
// 文档:大模型负责生成,中模型负责反思,规则/小模型负责意图识别。
// 安全(security.md):调用级 max_tokens 硬上限;不允许写入占位密钥兜底。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

export type ModelTier = 'large' | 'medium' | 'small';

/** 调用级输出硬上限(文档:token 三级防护第三级) */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface LlmModelBundle {
  large: ChatOpenAI; // 生成
  medium: ChatOpenAI; // 反思/重写
  small: ChatOpenAI; // 意图兜底
}

@Injectable()
export class LlmFactory {
  private readonly logger = new Logger(LlmFactory.name);
  private bundle: LlmModelBundle | null = null;
  /** 无可用密钥时标记为不可用:上层按"AI 降级可用"处理(规则/模板路径仍可服务) */
  private unavailableReason: string | null = null;

  constructor(private readonly config: ConfigService) {}

  /** OpenAI 兼容密钥(DashScope / OpenAI),无则返回 null */
  getApiKey(): string | null {
    return this.config.get('DASHSCOPE_API_KEY') || this.config.get('OPENAI_API_KEY') || null;
  }

  /** OpenAI 兼容 baseURL */
  getBaseUrl(): string {
    return this.config.get('DASHSCOPE_BASE_URL') || 'https://dashscope.aliyuncs.com/compatible-mode/v1';
  }

  /** 调用级 max_tokens 硬上限 */
  getMaxOutputTokens(): number {
    const raw = Number(this.config.get('LLM_MAX_OUTPUT_TOKENS'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_OUTPUT_TOKENS;
  }

  /** LLM 是否可用(仅取决于密钥是否存在) */
  isAvailable(): boolean {
    return this.getApiKey() != null;
  }

  /** 不可用原因(用于日志与 trace 降级字段) */
  getUnavailableReason(): string | null {
    if (this.isAvailable()) return null;
    return this.unavailableReason ?? '缺少 DASHSCOPE_API_KEY / OPENAI_API_KEY,AI 能力降级';
  }

  getModels(): LlmModelBundle {
    if (!this.bundle) {
      const apiKey = this.getApiKey();
      if (!apiKey) {
        this.unavailableReason = '缺少 DASHSCOPE_API_KEY / OPENAI_API_KEY';
        this.logger.warn(
          `${this.unavailableReason}:LLM 调用将失败,仅保留规则/模板降级路径。请在 .env 中配置密钥。`,
        );
      }
      const baseUrl = this.getBaseUrl();
      const maxTokens = this.getMaxOutputTokens();

      const create = (model: string, temperature = 0.2) =>
        new ChatOpenAI({
          // 无密钥时传占位空串仅为让构造函数通过,实际调用会失败并由上层降级
          openAIApiKey: apiKey ?? '',
          configuration: { baseURL: baseUrl },
          model,
          streaming: true,
          temperature,
          maxTokens,
        });

      this.bundle = {
        // 大模型:复杂生成
        large: create(this.config.get('LLM_MODEL_LARGE') || 'qwen-plus', 0.2),
        // 中模型:反思修正
        medium: create(this.config.get('LLM_MODEL_MEDIUM') || 'qwen-turbo', 0.1),
        // 小模型:意图分类兜底
        small: create(this.config.get('LLM_MODEL_SMALL') || 'qwen-turbo', 0),
      };
    }
    return this.bundle;
  }
}
