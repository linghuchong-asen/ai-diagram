// 语图技术方案 - 模型分层工厂
// 文档:大模型负责生成,中模型负责反思,规则/小模型负责意图识别。
// model-routing-batch:新增 flash 轻量生成档 —— Auto 复杂度路由与试用链路使用,
//   与 large(旗舰)构成「贵/便宜」两档;medium/small 仍是内部杂活档,不对用户暴露。
// 安全(security.md):调用级 max_tokens 硬上限;不允许写入占位密钥兜底。
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChatOpenAI } from '@langchain/openai';

export type ModelTier = 'large' | 'medium' | 'small' | 'flash';

/** 面向用户的生成档位(model-routing-batch):flagship=旗舰(贵,质量优先) / flash=轻量(便宜,快速) */
export type GenerationTier = 'flagship' | 'flash';

/** 调用级输出硬上限(文档:token 三级防护第三级) */
export const DEFAULT_MAX_OUTPUT_TOKENS = 4096;

export interface LlmModelBundle {
  large: ChatOpenAI; // 旗舰生成(Auto 复杂请求 / 手选旗舰)
  medium: ChatOpenAI; // 反思/重写/问答/摘要
  small: ChatOpenAI; // 意图兜底(保留档位,当前意图分类走 medium)
  flash: ChatOpenAI; // 轻量生成(Auto 简单请求 / 手选轻量 / 试用链路)
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
        // 旗舰档:复杂生成(env LLM_MODEL_LARGE,默认 qwen-plus)
        large: create(this.config.get('LLM_MODEL_LARGE') || 'qwen-plus', 0.2),
        // 中模型:反思修正/问答/摘要
        medium: create(this.config.get('LLM_MODEL_MEDIUM') || 'qwen-turbo', 0.1),
        // 小模型:意图分类兜底(保留)
        small: create(this.config.get('LLM_MODEL_SMALL') || 'qwen-turbo', 0),
        // 轻量档:简单请求生成(model-routing-batch,env LLM_MODEL_FLASH,默认 qwen-turbo;
        // 温度略高于 medium —— 同样是生成任务,需要一点多样性但保持稳定)
        flash: create(this.config.get('LLM_MODEL_FLASH') || 'qwen-turbo', 0.15),
      };
    }
    return this.bundle;
  }

  /**
   * 按用户侧生成档位取模型(model-routing-batch)。
   * 未知档位一律回落旗舰 —— 与复杂度路由的「不确定即质量优先」同一保守取向。
   */
  getModelForTier(tier: GenerationTier | string | undefined): ChatOpenAI {
    const models = this.getModels();
    return tier === 'flash' ? models.flash : models.large;
  }
}
