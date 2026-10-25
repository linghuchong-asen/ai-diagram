// 语图技术方案 - 意图识别服务(Task 7 落地版)
// 分层策略:规则优先(正则+关键词,覆盖 80%+ 场景) → 模型兜底(未命中 / 歧义 / 多规则命中 / 弱命中)
// 语义修正(Task 7.3):source 严格区分真实来源
//   - 'rule':结论来自确定性规则(含模型兜底失败后的启发式回落,回落原因写入 reasons)
//   - 'llm' :结论确实来自模型分类(附 token 用量)
// 输出意图仅用于路由决策,不访问记忆层(记忆检索在上下文组装节点按需触发)
import { Injectable, Logger, Optional } from '@nestjs/common';
import { IntentType } from '../schemas/chat.schema';
import { ContextSignals, matchByRules, RuleDecision, CONFIDENT_SCORE } from './intent.rules';
import {
  IntentClassifyResult,
  IntentLlmClassifier,
  IntentTokenUsage,
} from './intent.llm-classifier';

export interface IntentRecognizeOptions {
  query: string;
  signals: ContextSignals;
  /** 模型兜底超时(毫秒),默认沿用分类器内置值 */
  timeoutMs?: number;
}

/** 意图来源:'rule' = 确定性规则/启发式回落;'llm' = 模型分类(Task 7.3 真实语义) */
export type IntentSource = 'rule' | 'llm';

export interface IntentResult {
  intent: IntentType;
  source: IntentSource;
  confidence: number;
  reasons: string[];
  /** 仅 source='llm' 时可能存在的 token 用量(Task 7.3) */
  usage?: IntentTokenUsage;
  /** 是否经过模型兜底(无论成败),用于观测兜底触发率 */
  llmAttempted: boolean;
}

@Injectable()
export class IntentRecognizer {
  private readonly logger = new Logger(IntentRecognizer.name);

  constructor(@Optional() private readonly llmClassifier?: IntentLlmClassifier) {}

  async recognize(options: IntentRecognizeOptions): Promise<IntentResult> {
    const { query, signals } = options;
    const rule: RuleDecision = matchByRules(query, signals);

    this.logger.debug(`意图规则判定: ${JSON.stringify(rule)}`);

    // ---- 第一层:规则确定命中且无歧义 → 直接使用,绝不调用模型 ----
    const ruleConfident =
      rule.matched && rule.intent !== null && !rule.ambiguous && rule.score >= CONFIDENT_SCORE;
    if (ruleConfident) {
      return {
        intent: rule.intent!,
        source: 'rule',
        confidence: rule.score,
        reasons: rule.reasons,
        llmAttempted: false,
      };
    }

    // ---- 第二层:模型兜底(未命中 / 歧义 / 多规则命中 / 弱命中) ----
    if (this.llmClassifier) {
      const classified: IntentClassifyResult = await this.llmClassifier.classify(
        query,
        rule,
        options.timeoutMs,
      );
      if (classified.ok) {
        this.logger.debug(
          `意图模型兜底命中: ${classified.intent}(confidence=${classified.confidence}, usage=${JSON.stringify(
            classified.usage ?? null,
          )})`,
        );
        return {
          intent: classified.intent,
          source: 'llm',
          confidence: classified.confidence,
          reasons: [...rule.reasons, `模型兜底: ${classified.reason}`],
          usage: classified.usage,
          llmAttempted: true,
        };
      }
      // 兜底失败(超时/网络/非法输出)→ 回落规则,并把原因写入 reasons(可观测)
      this.logger.warn(`意图模型兜底失败,回落规则: ${classified.reason}`);
      return this.fallbackByHeuristic(query, rule, [`模型兜底失败,回落规则: ${classified.reason}`]);
    }

    // 未注入分类器(如单测/最小装配)→ 直接走内置启发式
    return this.fallbackByHeuristic(query, rule, ['未装配意图模型分类器,使用内置启发式']);
  }

  /**
   * 内置启发式回落(Task 7.3):本质仍是确定性程序,因此 source 必须标 'rule' 而非 'llm'。
   * 回落原因追加到 reasons,便于线上定位「为什么这一轮没走模型」。
   */
  private fallbackByHeuristic(query: string, rule: RuleDecision, extraReasons: string[] = []): IntentResult {
    const q = query.toLowerCase();
    const reasons = [...rule.reasons, ...extraReasons];

    // 规则已给出(弱)结论时优先沿用规则结论,避免启发式与规则互相打架
    if (rule.matched && rule.intent) {
      return {
        intent: rule.intent,
        source: 'rule',
        confidence: Math.min(rule.score, 0.55),
        reasons: [...reasons, `启发式回落:沿用规则结论 ${rule.intent}`],
        llmAttempted: extraReasons.length > 0,
      };
    }

    // 咨询类:疑问句式
    if (/^(为什么|怎么|如何|是否|能不能|请问|解释|说明)/.test(q) || /[?？]$/.test(q)) {
      return {
        intent: 'consult',
        source: 'rule',
        confidence: 0.5,
        reasons: [...reasons, '启发式:疑问句式'],
        llmAttempted: extraReasons.length > 0,
      };
    }
    // 修改类:包含"把...改/加/删"等
    if (/(把|将).*(改|加|删|换|移)/.test(q) || /(改成|变成|增加|删除|去掉|添加|调整为)/.test(q)) {
      return {
        intent: 'modify',
        source: 'rule',
        confidence: 0.5,
        reasons: [...reasons, '启发式:修改句式'],
        llmAttempted: extraReasons.length > 0,
      };
    }
    // 默认:生成
    return {
      intent: 'generate',
      source: 'rule',
      confidence: 0.4,
      reasons: [...reasons, '启发式:默认生成'],
      llmAttempted: extraReasons.length > 0,
    };
  }
}
