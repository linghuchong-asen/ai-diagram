// 语图技术方案 - 意图识别「模型兜底」分类器(Task 7.1 / 7.2)
// 定位:规则优先(确定性程序覆盖 80%+ 场景),仅在「未命中 / 无动词特征 / 歧义 / 多规则命中」时调用模型。
// 约束:
//   1) 模型只读获取(LlmFactory.getModels()),不修改适配器层;
//   2) 输出必须过 zod 校验(generate|modify|consult 枚举),非法值一律视为失败;
//   3) 调用必须超时 + try/catch,失败绝不抛出,由调用方回落规则;
//   4) 透传 token 用量,便于成本观测。
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { LlmFactory } from '../adapters/llm.factory';
import { INTENT_SYSTEM_PROMPT } from '../prompts/system.prompt';
import { INTENT_TYPES, IntentType } from '../schemas/chat.schema';
import { sanitizeForLlm } from '../tools/error-sanitizer';
import { RuleDecision } from './intent.rules';

/** 模型兜底的 token 用量(意图识别属于轻量调用,用量用于成本观测) */
export interface IntentTokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

/** 模型输出的 zod 契约:意图枚举 + 置信度 + 理由 */
export const IntentClassificationSchema = z.object({
  intent: z.enum(INTENT_TYPES),
  confidence: z.number().min(0).max(1).optional(),
  reason: z.string().max(200).optional(),
});

export type IntentClassification = z.infer<typeof IntentClassificationSchema>;

/** 兜底成功 */
export interface IntentClassifyOk {
  ok: true;
  intent: IntentType;
  confidence: number;
  reason: string;
  usage?: IntentTokenUsage;
}

/** 兜底失败(超时 / 网络 / 非法输出):必须携带原因,供调用方记录回落理由 */
export interface IntentClassifyFail {
  ok: false;
  reason: string;
}

export type IntentClassifyResult = IntentClassifyOk | IntentClassifyFail;

/** 默认超时:意图识别是链路第一跳,不能拖慢首 token 时间 */
export const DEFAULT_INTENT_TIMEOUT_MS = 6000;

/** 模型未给置信度时的保守默认值(低于规则命中强度,便于日志区分) */
const DEFAULT_LLM_CONFIDENCE = 0.7;

@Injectable()
export class IntentLlmClassifier {
  private readonly logger = new Logger(IntentLlmClassifier.name);

  constructor(private readonly llmFactory: LlmFactory) {}

  /**
   * 调用 medium 层模型做意图分类。
   * @param query 用户原始输入
   * @param rule  规则判定结果(作为提示词里的「候选线索」,可为 null)
   * @param timeoutMs 超时时间,默认 6s
   */
  async classify(
    query: string,
    rule: RuleDecision | null = null,
    timeoutMs: number = DEFAULT_INTENT_TIMEOUT_MS,
  ): Promise<IntentClassifyResult> {
    try {
      const { medium } = this.llmFactory.getModels();
      const response: any = await this.withTimeout(
        medium.invoke([
          { role: 'system', content: INTENT_SYSTEM_PROMPT },
          { role: 'user', content: buildClassifierUserPrompt(query, rule) },
        ]),
        timeoutMs,
        '意图分类模型',
      );

      const text = extractMessageText(response);
      const parsed = this.parseModelOutput(text);
      // 注:项目 tsconfig 关闭了 strictNullChecks,真值判断无法收窄可辨识联合,故用显式比较
      if (parsed.ok === false) {
        // 解析失败:记录原因,交由调用方回落规则(不抛出)
        this.logger.warn(`意图模型输出未通过 zod 校验,回落规则: ${parsed.reason} | 原始输出="${text.slice(0, 80)}"`);
        return { ok: false, reason: parsed.reason };
      }

      return {
        ok: true,
        intent: parsed.value.intent,
        confidence: parsed.value.confidence ?? DEFAULT_LLM_CONFIDENCE,
        reason: parsed.value.reason ?? '模型分类',
        usage: extractTokenUsage(response),
      };
    } catch (err: any) {
      // 超时 / 网络 / 适配器异常:一律降级为「兜底失败」,不向上抛出
      const reason = `意图模型兜底失败: ${sanitizeForLlm(err)}`;
      this.logger.warn(reason);
      return { ok: false, reason };
    }
  }

  /**
   * 解析模型输出:
   *   ① 优先按 JSON 解析并过 zod;
   *   ② 退化为「文本中出现的第一个合法意图词」;
   *   ③ 都不满足 → 失败(绝不猜测)。
   */
  private parseModelOutput(
    text: string,
  ): { ok: true; value: IntentClassification } | { ok: false; reason: string } {
    const raw = String(text ?? '').trim();
    if (!raw) return { ok: false, reason: '模型返回空内容' };

    // ① JSON 形态:{"intent":"generate","confidence":0.9}
    const json = extractJsonFragment(raw);
    if (json) {
      try {
        const result = IntentClassificationSchema.safeParse(JSON.parse(json));
        if (result.success) return { ok: true, value: result.data };
        return { ok: false, reason: `zod 校验失败: ${result.error.issues.map((i) => i.message).join('; ')}` };
      } catch (e: any) {
        return { ok: false, reason: `JSON 解析失败: ${e?.message ?? 'unknown'}` };
      }
    }

    // ② 纯词形态:INTENT_SYSTEM_PROMPT 要求「只输出一个词」
    const normalized = raw.toLowerCase().replace(/[^a-z]/g, '');
    const hit = INTENT_TYPES.find((t) => normalized === t);
    if (hit) return { ok: true, value: { intent: hit } };

    // ③ 文本中出现合法意图词(容忍模型多话)
    const loose = INTENT_TYPES.find((t) => raw.toLowerCase().includes(t));
    if (loose) return { ok: true, value: { intent: loose, reason: '模型输出含合法意图词' } };

    return { ok: false, reason: `模型输出不含合法意图枚举(generate|modify|consult): "${raw.slice(0, 40)}"` };
  }

  /** 超时保护:超时即 reject,原 promise 静默吞掉避免 unhandled rejection */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, tag: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const guarded = promise.catch((err) => {
      throw err;
    });
    try {
      return await Promise.race([
        guarded,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${tag}调用超时(${timeoutMs}ms)`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
      // 超时后原调用可能仍在进行,其结果/异常不再关心
      void guarded.catch(() => undefined);
    }
  }
}

/** 组装分类器 user 提示词:附带规则线索,提升歧义场景的判定准确率 */
export function buildClassifierUserPrompt(query: string, rule: RuleDecision | null): string {
  const lines: string[] = [`用户请求:${query}`];
  if (rule) {
    if (rule.matched && rule.intent) {
      lines.push(`规则线索:候选意图 ${rule.intent}(强度 ${rule.score.toFixed(2)}),依据:${rule.reasons.join(' / ')}`);
    } else {
      lines.push(`规则线索:未命中确定性规则(${rule.reasons.join(' / ')})`);
    }
  }
  lines.push('请只输出分类词 generate / modify / consult 之一。');
  return lines.join('\n');
}

/** 从 LangChain 消息对象中抽取纯文本(content 可能是 string 或分片数组) */
export function extractMessageText(response: any): string {
  const content = response?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === 'string' ? part : (part?.text ?? '')))
      .join('');
  }
  if (typeof response?.text === 'string') return response.text;
  return '';
}

/**
 * 抽取 token 用量:兼容两种 LangChain 返回结构
 *   - response_metadata.token_usage.{prompt_tokens,completion_tokens,total_tokens}(OpenAI 兼容端点)
 *   - usage_metadata.{input_tokens,output_tokens,total_tokens}(标准 LangChain)
 */
export function extractTokenUsage(response: any): IntentTokenUsage | undefined {
  const tu = response?.response_metadata?.token_usage;
  if (tu && typeof tu === 'object') {
    const promptTokens = toNumber(tu.prompt_tokens);
    const completionTokens = toNumber(tu.completion_tokens);
    const totalTokens = toNumber(tu.total_tokens) ?? (promptTokens ?? 0) + (completionTokens ?? 0);
    if (promptTokens || completionTokens || totalTokens) {
      return { promptTokens: promptTokens ?? 0, completionTokens: completionTokens ?? 0, totalTokens };
    }
  }
  const um = response?.usage_metadata;
  if (um && typeof um === 'object') {
    const promptTokens = toNumber(um.input_tokens);
    const completionTokens = toNumber(um.output_tokens);
    const totalTokens = toNumber(um.total_tokens) ?? (promptTokens ?? 0) + (completionTokens ?? 0);
    if (promptTokens || completionTokens || totalTokens) {
      return { promptTokens: promptTokens ?? 0, completionTokens: completionTokens ?? 0, totalTokens };
    }
  }
  return undefined;
}

function toNumber(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 从文本中截取第一个 JSON 对象片段(容忍 markdown 包裹) */
function extractJsonFragment(raw: string): string | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced && fenced[1].trim().startsWith('{')) return fenced[1].trim();
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return null;
}
