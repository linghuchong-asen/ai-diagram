// 语图技术方案 - 意图识别规则库
// 核心哲学:确定性程序优先。意图识别优先用正则+关键词规则(覆盖 80%+ 场景),模型兜底。
// 规则三要素:动词特征 / 画布上下文 / 指令模式
import { IntentType } from '../schemas/chat.schema';

// ---- 动词特征规则(按优先级) ----
export interface VerbRule {
  intent: IntentType;
  verbs: string[];
}

// generate 场景:从无到有画流程图
const GENERATE_VERBS = [
  '生成',
  '画',
  '创建',
  '绘制',
  '做一个',
  '设计',
  '规划',
  '帮我画',
  '写一个',
  '生成一个',
  '画一个',
  '创建流程',
  '做个',
  '梳理',
  '画出',
];

// modify 场景:改已有画布
const MODIFY_VERBS = [
  '修改',
  '改',
  '调整',
  '添加',
  '加上',
  '删除',
  '去掉',
  '移除',
  '优化',
  '完善',
  '补充',
  '改成',
  '变为',
  '增加一个',
  '加一个',
  '删掉',
  '移动',
  '换个',
  '替换',
  '更新',
  '把',
];

// consult 场景:提问、解释、咨询(不产生结构化改动)
const CONSULT_VERBS = [
  '为什么',
  '怎么',
  '如何',
  '是什么',
  '什么意思',
  '解释',
  '讲讲',
  '说明',
  '区别',
  '介绍',
  '了解',
  '？',
  '?',
];

export const VERB_RULES: VerbRule[] = [
  { intent: 'modify', verbs: MODIFY_VERBS },
  { intent: 'generate', verbs: GENERATE_VERBS },
  { intent: 'consult', verbs: CONSULT_VERBS },
];

// ---- 画布上下文特征(用于规则兜底决策) ----
export interface ContextSignals {
  hasCanvas: boolean; // 是否已有画布
  canvasNodes: number; // 现有节点数
  hasSelection: boolean; // 是否有选中节点
  query: string;
}

// ---- 规则判定结果 ----
export interface RuleDecision {
  matched: boolean;
  intent: IntentType | null;
  score: number; // 0~1,规则命中强度
  reasons: string[];
  /**
   * 歧义标记(Task 7.1):true 表示规则给出了结论,但结论是靠「上下文猜测/降级」得来,
   * 不是确定性动词特征,应交由模型兜底复核。触发条件:
   *   - 多个意图规则同时命中(即使靠画布上下文消歧)
   *   - modify 无画布被降级为 generate
   *   - 命中强度低于 CONFIDENT_SCORE 阈值
   */
  ambiguous: boolean;
  /** 本轮命中的全部意图(用于日志与提示词线索) */
  hitIntents: IntentType[];
}

/** 规则「确定命中」的强度阈值:低于此值视为弱命中,需模型兜底复核 */
export const CONFIDENT_SCORE = 0.5;

/**
 * 规则识别器:返回是否命中及命中的意图。
 * 命中强度判断:
 *  - 若同时命中 generate 与 modify,则参考画布上下文(有画布倾向 modify,无画布倾向 generate)
 * 歧义标记(Task 7.1):多规则命中 / 上下文降级 / 弱命中 都会置 ambiguous=true,由模型兜底复核。
 */
export function matchByRules(query: string, signals: ContextSignals): RuleDecision {
  const q = query.toLowerCase();
  const reasons: string[] = [];
  const hits: Array<{ intent: IntentType; score: number }> = [];

  for (const rule of VERB_RULES) {
    let found = 0;
    for (const verb of rule.verbs) {
      if (q.includes(verb.toLowerCase())) {
        found++;
        reasons.push(`命中动词"${verb}"→${rule.intent}`);
      }
    }
    if (found > 0) {
      hits.push({ intent: rule.intent, score: Math.min(1, 0.5 + found * 0.15) });
    }
  }

  const hitIntents = Array.from(new Set(hits.map((h) => h.intent)));

  // 未命中任何动词规则:无确定性特征,必须交模型兜底
  if (hits.length === 0) {
    return {
      matched: false,
      intent: null,
      score: 0,
      reasons: ['未命中任何动词规则'],
      ambiguous: true,
      hitIntents: [],
    };
  }

  // 多规则命中即为歧义(即使下文能用画布上下文消歧,也标记为需复核)
  const multiHit = hitIntents.length > 1;

  // 取命中强度最高的意图
  const top = hits.sort((a, b) => b.score - a.score)[0];

  // 多意图命中时的上下文消歧:generate vs modify
  if (hits.some((h) => h.intent === 'generate') && hits.some((h) => h.intent === 'modify')) {
    if (signals.hasCanvas && signals.canvasNodes > 0) {
      reasons.push('已有画布,倾向 modify');
      return { matched: true, intent: 'modify', score: top.score, reasons, ambiguous: true, hitIntents };
    }
    reasons.push('无画布,倾向 generate');
    return { matched: true, intent: 'generate', score: top.score, reasons, ambiguous: true, hitIntents };
  }

  // modify 意图但无画布 → 降级为 generate(降级即歧义)
  if (top.intent === 'modify' && !signals.hasCanvas) {
    reasons.push('modify 意图但无画布,降级为 generate');
    const score = top.score - 0.1;
    return {
      matched: true,
      intent: 'generate',
      score,
      reasons,
      ambiguous: true,
      hitIntents,
    };
  }

  // 单一意图命中:强度不足仍视为歧义(弱命中)
  const ambiguous = multiHit || top.score < CONFIDENT_SCORE;
  if (ambiguous) reasons.push('规则弱命中,需模型兜底复核');

  return { matched: true, intent: top.intent, score: top.score, reasons, ambiguous, hitIntents };
}
