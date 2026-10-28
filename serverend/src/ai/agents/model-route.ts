// 语图技术方案 - 模型档位路由(model-routing-batch)
// 定位:Trae 式模型选择的服务端决策核心 —— 用户手选具体档位则直通,
//   Auto 模式按「复杂度」决定用旗舰(flash 的对立面,质量优先)还是轻量(flash,成本优先)。
// 设计原则(与意图识别/形态路由同构的分层策略):
//   1) 确定性规则优先:短请求 + 无分支信号 → 简单(零 token 即可判定,覆盖多数请求);
//   2) 意图模型兜底顺带输出:规则拿不准时,复用意图分类那一次 medium 调用的 complexity 字段
//      (一次调用两用,绝不为了判复杂度单独再调一次模型 —— 否则省下的钱抵不上多花的调用);
//   3) 保守默认:规则与模型都拿不准 → 旗舰(误判到轻量的代价是「用户觉得产品变笨」,比多花钱更伤)。
//   4) 误判兜底不靠前置精判:轻量档生成若连续反思失败,由 graph 在末次重试升级旗舰(Rewriter 链路)。
import type { IntentType, ModelPreference } from '../schemas/chat.schema';
import type { GenerationTier } from '../adapters/llm.factory';

/** 复杂度结论来源(观测字段):rule=确定性规则;llm=意图模型兜底顺带输出;default=保守默认 */
export type ComplexitySource = 'rule' | 'llm' | 'default';

/** 档位决策来源(观测字段):trial-force=试用强制;preference=用户手选;rule/llm/default=Auto 分层 */
export type ModelRouteSource = 'trial-force' | 'preference' | 'rule' | 'llm' | 'default' | 'vip-fallback';

export interface ModelRouteInput {
  /** 用户模型偏好(缺省视为 auto) */
  modelPreference?: ModelPreference;
  /** 意图识别结果(generate/modify 走生成档位;consult 由 runConsult 走 medium,不经过本路由) */
  intent: IntentType;
  /** 用户原始输入(复杂度规则的判定对象) */
  query: string;
  /** 意图模型兜底顺带输出的复杂度(仅意图分类真的调了模型时存在) */
  llmComplexity?: 'simple' | 'complex';
  /** 是否会员(手选旗舰的门槛;Auto 路由不受会员限制 —— 质量优先) */
  isVip: boolean;
  /** 是否免登录试用链路(强制 flash 控成本;末次重试仍可升级旗舰救质量) */
  isTrial: boolean;
}

export interface ModelRouteDecision {
  tier: GenerationTier;
  source: ModelRouteSource;
  reasons: string[];
  /** 本次决策产出的复杂度结论(trial-force/手选直通路径可能没有) */
  complexity?: 'simple' | 'complex';
  /** 复杂度结论来源(rule/llm/default) */
  complexitySource?: ComplexitySource;
}

/** 分支/条件类复杂度信号词:命中说明流程含判断分支,交旗舰更稳 */
const COMPLEX_SIGNAL_WORDS = [
  '如果',
  '若',
  '否则',
  '条件',
  '判断',
  '分支',
  '驳回',
  '退回',
  '退回重',
  '超时',
  '并行',
  '同时',
  '或者',
  '要么',
  '多阶段',
  '复核',
  '评审',
  '会签',
  '循环',
  '回退',
  '异常',
  '失败则',
];

/** 简单请求的长度上限:短句 + 无复杂信号 → 直接判简单(零 token) */
const SIMPLE_MAX_LENGTH = 40;
/** 超过该长度直接判复杂(长描述通常意味着多步骤/多角色) */
const COMPLEX_MIN_LENGTH = 120;

/**
 * 确定性复杂度估计(零 token):
 *   命中复杂信号 → complex;短且无信号 → simple;其余返回 null(交给 llm/default 层)。
 */
export function estimateComplexityByRules(
  query: string,
): { complexity: 'simple' | 'complex'; reason: string } | null {
  const text = String(query ?? '').trim();
  if (!text) return { complexity: 'simple', reason: '空输入按简单处理' };

  const signalHits = COMPLEX_SIGNAL_WORDS.filter((w) => text.includes(w));
  const arrowHits = (text.match(/→|->|=>/g) ?? []).length;

  // 结构化分隔符(分号/换行)多 → 步骤多,偏复杂
  const stepSeparators = (text.match(/[;；\n]/g) ?? []).length;

  if (signalHits.length >= 2 || (signalHits.length >= 1 && arrowHits >= 2)) {
    return {
      complexity: 'complex',
      reason: `分支信号密集(${signalHits.slice(0, 3).join('/')}),交旗舰`,
    };
  }
  if (arrowHits >= 4 || stepSeparators >= 4) {
    return { complexity: 'complex', reason: `步骤分隔符多(箭头x${arrowHits}/分隔x${stepSeparators}),交旗舰` };
  }
  if (text.length >= COMPLEX_MIN_LENGTH) {
    return { complexity: 'complex', reason: `长描述(${text.length}字),交旗舰` };
  }
  if (text.length <= SIMPLE_MAX_LENGTH && signalHits.length === 0 && arrowHits <= 1) {
    return { complexity: 'simple', reason: `短句无分支信号(${text.length}字),交轻量` };
  }
  // 中等长度 / 单个弱信号:规则拿不准
  return null;
}

/**
 * 生成档位决策(generate/modify 主生成用;consult 不经过此函数)。
 * 优先级:试用强制 flash → 用户手选(旗舰需会员) → Auto 分层(规则 → llm 复用 → 保守默认)。
 */
export function decideGenerationTier(input: ModelRouteInput): ModelRouteDecision {
  const { modelPreference, intent, query, llmComplexity, isVip, isTrial } = input;
  const reasons: string[] = [`intent=${intent}`];

  // ---- 1) 试用链路:匿名请求是纯成本项,一律轻量档(全局限流之外的省线闸) ----
  if (isTrial) {
    return { tier: 'flash', source: 'trial-force', reasons: ['试用链路强制轻量档(成本控制)'] };
  }

  // ---- 2) 用户手选:直通该档;flagship 为会员档,非会员回落 Auto(不报错,体验平滑) ----
  if (modelPreference === 'flash') {
    return { tier: 'flash', source: 'preference', reasons: [...reasons, '用户手选轻量档'] };
  }
  if (modelPreference === 'flagship') {
    if (isVip) {
      return { tier: 'flagship', source: 'preference', reasons: [...reasons, '会员手选旗舰档'] };
    }
    reasons.push('手选旗舰需会员,回落智能路由');
  }

  // ---- 3) Auto:规则优先 → 意图模型顺带输出 → 保守默认旗舰 ----
  const ruleEstimate = estimateComplexityByRules(query);
  if (ruleEstimate) {
    return {
      tier: ruleEstimate.complexity === 'simple' ? 'flash' : 'flagship',
      source: 'rule',
      reasons: [...reasons, `规则:${ruleEstimate.reason}`],
      complexity: ruleEstimate.complexity,
      complexitySource: 'rule',
    };
  }
  if (llmComplexity) {
    return {
      tier: llmComplexity === 'simple' ? 'flash' : 'flagship',
      source: 'llm',
      reasons: [...reasons, `意图模型兜底顺带输出 complexity=${llmComplexity}`],
      complexity: llmComplexity,
      complexitySource: 'llm',
    };
  }
  return {
    tier: 'flagship',
    source: 'default',
    reasons: [...reasons, '规则与模型均未给出复杂度,保守默认旗舰(质量优先)'],
    complexity: 'complex',
    complexitySource: 'default',
  };
}
