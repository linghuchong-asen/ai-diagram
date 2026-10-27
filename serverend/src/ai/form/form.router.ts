// 语图技术方案 - 形式路由器(multi-artifact-batch Round 3)
// 定位:generate 意图内的「二级路由」——意图决定「要不要产结构」,本路由决定「产什么形态的结构」。
// 设计哲学与意图识别一致(确定性程序优先):
//   1) formHint 用户显式指定 → 直接采用(零 token,优先级最高);
//   2) 关键词规则 → 单形态强度领先且高于流程图信号 → 直接采用(零 token);
//   2') 会话形态偏好(competitor-driven-evolution-batch Round 15)→ 规则歧义/全未命中时,
//       若本会话某形态已产出 ≥2 次且严格最多 → 直接采信(省一次 LLM 兜底;source 仍记 'rule');
//   3) 规则歧义(多形态命中 / 与流程图信号打平 / 全未命中)→ LLM 兜底分类(medium 模型,带超时);
//   4) LLM 不可用 / 输出非法 / 超时 → 默认 flowchart(旗舰场景兜底,绝不阻塞主链路)。
// 红线:会话偏好绝不覆盖 formHint(显式指定永远最高优先级);偏好并列/不足阈值时忽略。
import { Injectable, Logger } from '@nestjs/common';
import { LlmFactory } from '../adapters/llm.factory';
import { ARTIFACT_KINDS, ArtifactKind } from '../schemas/artifact.schema';
import { IntentTokenUsage, extractMessageText, extractTokenUsage } from '../intent/intent.llm-classifier';
import { sanitizeForLlm } from '../tools/error-sanitizer';

/** 形式路由结果:kind + 来源(hint/rule/llm/default) + 理由链(可观测) */
export interface FormRouteResult {
  kind: ArtifactKind;
  source: 'hint' | 'rule' | 'llm' | 'default';
  reasons: string[];
  /** 是否尝试过 LLM 兜底(成本观测) */
  llmAttempted: boolean;
  /** LLM 兜底的 token 用量(未调用时为空) */
  usage?: IntentTokenUsage;
}

/** 各形态的关键词规则(命中计分;分数领先者胜出) */
export interface FormKeywordRule {
  kind: ArtifactKind;
  keywords: string[];
}

/**
 * 四种新形态的关键词表:选词原则是「该形态的领域专属词」,
 * 避免收录与流程图场景高频共现的泛化动词(如"梳理/规划"),防止误路由。
 */
export const FORM_KEYWORD_RULES: FormKeywordRule[] = [
  {
    kind: 'mindmap',
    keywords: ['思维导图', '脑图', '导图', '脑暴', '头脑风暴', '大纲', '知识体系', '知识结构', '读书笔记', '学习笔记'],
  },
  {
    kind: 'table',
    keywords: ['对比', '比较一下', '优缺点', '利弊', '怎么选', '选哪个', '表格', '横评', '评测', ' vs ', 'vs.', 'versus'],
  },
  {
    kind: 'checklist',
    keywords: ['清单', '待办', '检查单', '核对单', '核对清单', '注意事项', '准备事项', '物料清单', '行李清单', 'packing list'],
  },
  {
    kind: 'timeline',
    keywords: ['时间线', '行程', '排期', '日程', '时间表', '计划表', '甘特', '第几天', 'day1', 'day2', '几点'],
  },
];

/**
 * 流程图信号词:出现这些词时默认倾向 flowchart(旗舰场景)。
 * 与四形态信号打平时视为歧义 → 交 LLM 裁决(如「对比一下这两个流程」既是对比又含流程)。
 */
export const FLOWCHART_SIGNALS = ['流程图', '流程', '步骤', '审批', 'sop', '工作流', 'workflow', '泳道', '流转'];

/** LLM 兜底超时:形式路由不能拖慢生成链路首 token,比意图识别更紧 */
export const DEFAULT_FORM_ROUTE_TIMEOUT_MS = 4000;

/** 形式路由 LLM 系统提示词:按「问题本质结构」选择形态,而非按字面词 */
export const FORM_ROUTE_SYSTEM_PROMPT = `你是产物形态路由器。根据用户问题的本质结构,选择最合适的结构化产物形态,只输出一个词:
- flowchart:有先后顺序、有分支判断的过程(审批流/操作步骤/故障排查/系统交互)
- mindmap:有层级、需要发散与归类的主题(读书笔记/知识体系/需求脑暴/主题总结)
- table:多个对象按多个维度横向比较(方案对比/技术选型/优缺点横评)
- checklist:可逐项勾选、怕遗漏的事项集合(待办/检查单/出发准备/注意事项)
- timeline:按时间先后推进的安排(旅行行程/项目排期/活动日程)
规则:用户显式提到思维导图/表格/清单/时间线的,按显式形态判断;只输出上述五个词之一,不输出其他内容。`;

/** 规则层打分:query 命中各形态关键词的次数(小写化匹配,中英文统一) */
export function scoreFormKeywords(query: string): { scores: Partial<Record<ArtifactKind, number>>; hitKeywords: Partial<Record<ArtifactKind, string[]>> } {
  const q = ` ${query.toLowerCase()} `;
  const scores: Partial<Record<ArtifactKind, number>> = {};
  const hitKeywords: Partial<Record<ArtifactKind, string[]>> = {};
  for (const rule of FORM_KEYWORD_RULES) {
    for (const keyword of rule.keywords) {
      if (q.includes(keyword.toLowerCase())) {
        scores[rule.kind] = (scores[rule.kind] ?? 0) + 1;
        (hitKeywords[rule.kind] ??= []).push(keyword);
      }
    }
  }
  // 流程图信号单独计分(与其他形态比较强弱)
  let flowchartScore = 0;
  const flowchartHits: string[] = [];
  for (const signal of FLOWCHART_SIGNALS) {
    if (q.includes(signal.toLowerCase())) {
      flowchartScore += 1;
      flowchartHits.push(signal);
    }
  }
  if (flowchartScore > 0) {
    scores.flowchart = flowchartScore;
    hitKeywords.flowchart = flowchartHits;
  }
  return { scores, hitKeywords };
}

/** 纯规则判定(无副作用,供测试与 LLM 提示词复用):返回唯一胜者或 null(歧义/全未命中) */
export function matchFormByRules(query: string): { kind: ArtifactKind | null; reasons: string[] } {
  const { scores, hitKeywords } = scoreFormKeywords(query);
  const entries = Object.entries(scores) as Array<[ArtifactKind, number]>;
  const reasons: string[] = [];
  for (const [kind, score] of entries) {
    reasons.push(`命中${kind}信号 ${(hitKeywords[kind] ?? []).join('/')}(强度 ${score})`);
  }
  if (entries.length === 0) {
    return { kind: null, reasons: ['未命中任何形态关键词'] };
  }
  // 按强度降序;并列最高视为歧义(null → 交 LLM)
  entries.sort((a, b) => b[1] - a[1]);
  const [topKind, topScore] = entries[0];
  const tied = entries.filter(([, score]) => score === topScore);
  if (tied.length > 1) {
    return { kind: null, reasons: [...reasons, `多形态信号并列(强度 ${topScore}),交模型裁决`] };
  }
  return { kind: topKind, reasons };
}

/** 会话偏好判定阈值:某形态在本会话已产出 ≥2 次才构成「稳定偏好」(competitor-driven-evolution-batch Round 15) */
export const SESSION_PREFERENCE_MIN_COUNT = 2;

/**
 * competitor-driven-evolution-batch Round 15:会话形态偏好纯函数。
 * 某形态计数 ≥2 且严格最多 → 采信;计数全 0 / 最高分不足阈值 / 并列最多 / 参数缺省 → null(忽略)。
 * 为什么:对话生成有强场景连贯性(用户反复要表格,说明本会话就是表格场景),
 *       规则歧义时采信偏好既省一次 LLM 兜底分类、也更贴近用户当前心智;
 *       但 formHint 显式指定永远优先,偏好只在「无显式指定且规则无果」时兜底。
 */
export function applySessionPreference(
  usage?: Partial<Record<ArtifactKind, number>>,
): { kind: ArtifactKind | null; reason: string } {
  if (!usage) return { kind: null, reason: '' };
  const entries = (Object.entries(usage) as Array<[ArtifactKind, number]>).filter(([, count]) => count > 0);
  if (entries.length === 0) return { kind: null, reason: '' };
  entries.sort((a, b) => b[1] - a[1]);
  const [topKind, topCount] = entries[0];
  if (topCount < SESSION_PREFERENCE_MIN_COUNT) return { kind: null, reason: '' };
  const tied = entries.filter(([, count]) => count === topCount);
  if (tied.length > 1) return { kind: null, reason: '' };
  return { kind: topKind, reason: `会话偏好:本会话已 ${topCount} 次产出 ${topKind},规则歧义时直接采信` };
}

@Injectable()
export class FormRouter {
  private readonly logger = new Logger(FormRouter.name);

  constructor(private readonly llmFactory: LlmFactory) {}

  /**
   * 形式路由主入口:
   *   formHint → 规则 → 会话偏好(R15) → LLM 兜底 → 默认 flowchart。
   * 任何异常都不抛出(路由失败不阻塞生成链路)。
   * sessionFormUsage(R15):本会话各形态累计产出次数(由 AiService 台账传入,缺省时行为不变)。
   */
  async route(
    query: string,
    formHint?: ArtifactKind,
    sessionFormUsage?: Partial<Record<ArtifactKind, number>>,
  ): Promise<FormRouteResult> {
    // ① 用户显式指定:零 token 直通(前端快捷 chips / 用户点名形态)。
    //    会话偏好绝不覆盖 formHint——显式指定永远最高优先级
    if (formHint) {
      return { kind: formHint, source: 'hint', reasons: ['用户显式指定 formHint'], llmAttempted: false };
    }

    // ② 关键词规则:唯一领先者直接采用(确定性程序优先,零 token)
    const ruleMatch = matchFormByRules(query);
    if (ruleMatch.kind) {
      return { kind: ruleMatch.kind, source: 'rule', reasons: ruleMatch.reasons, llmAttempted: false };
    }

    // ②' 会话形态偏好(R15):规则歧义/全未命中时,若某形态已 ≥2 次且严格最多 → 直接采信,
    //    省一次 LLM 兜底分类(source 仍记 'rule',reason 注明偏好来源,可观测可回溯)
    const preference = applySessionPreference(sessionFormUsage);
    if (preference.kind) {
      return {
        kind: preference.kind,
        source: 'rule',
        reasons: [...ruleMatch.reasons, preference.reason],
        llmAttempted: false,
      };
    }

    // ③ LLM 兜底:规则歧义或全未命中。不可用/失败/超时 → 默认 flowchart
    const llmAttempted = this.llmFactory.isAvailable();
    if (!llmAttempted) {
      return {
        kind: 'flowchart',
        source: 'default',
        reasons: [...ruleMatch.reasons, 'LLM 不可用,默认 flowchart'],
        llmAttempted: false,
      };
    }
    const llm = await this.classifyByLlm(query, ruleMatch.reasons);
    if (llm.ok) {
      return { kind: llm.kind, source: 'llm', reasons: [...ruleMatch.reasons, llm.reason], llmAttempted: true, usage: llm.usage };
    }
    return {
      kind: 'flowchart',
      source: 'default',
      reasons: [...ruleMatch.reasons, llm.reason, '兜底默认 flowchart'],
      llmAttempted: true,
    };
  }

  /** LLM 兜底分类(内部):失败返回原因,绝不抛出 */
  private async classifyByLlm(
    query: string,
    ruleReasons: string[],
  ): Promise<{ ok: true; kind: ArtifactKind; reason: string; usage?: IntentTokenUsage } | { ok: false; reason: string }> {
    try {
      const { medium } = this.llmFactory.getModels();
      const userPrompt = [
        `用户请求:${query}`,
        ruleReasons.length ? `规则线索:${ruleReasons.join(' / ')}` : '',
        '请只输出 flowchart / mindmap / table / checklist / timeline 之一。',
      ]
        .filter(Boolean)
        .join('\n');

      const response: any = await this.withTimeout(
        medium.invoke([
          { role: 'system', content: FORM_ROUTE_SYSTEM_PROMPT },
          { role: 'user', content: userPrompt },
        ]),
        DEFAULT_FORM_ROUTE_TIMEOUT_MS,
        '形式路由模型',
      );

      const parsed = this.parseModelOutput(extractMessageText(response));
      if (parsed.ok === false) {
        this.logger.warn(`形式路由模型输出非法,默认 flowchart: ${parsed.reason}`);
        return parsed;
      }
      return { ok: true, kind: parsed.kind, reason: `模型判定 ${parsed.kind}`, usage: extractTokenUsage(response) };
    } catch (err: any) {
      const reason = `形式路由模型兜底失败: ${sanitizeForLlm(err)}`;
      this.logger.warn(reason);
      return { ok: false, reason };
    }
  }

  /** 解析模型输出:① 纯枚举词 ② JSON {"form":...} ③ 文本中出现的唯一合法词;多词共存视为非法 */
  private parseModelOutput(text: string): { ok: true; kind: ArtifactKind } | { ok: false; reason: string } {
    const raw = String(text ?? '').trim().toLowerCase();
    if (!raw) return { ok: false, reason: '模型返回空内容' };
    const exact = ARTIFACT_KINDS.find((k) => raw === k);
    if (exact) return { ok: true, kind: exact };
    // JSON 形态
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        const obj = JSON.parse(raw.slice(start, end + 1));
        const form = String(obj?.form ?? obj?.kind ?? '').toLowerCase();
        const hit = ARTIFACT_KINDS.find((k) => k === form);
        if (hit) return { ok: true, kind: hit };
      } catch {
        // 非法 JSON 落到词匹配
      }
    }
    // 宽松词匹配:必须唯一,否则非法(防止 "mindmap or table" 这类含糊输出被误采)
    const hits = ARTIFACT_KINDS.filter((k) => raw.includes(k));
    if (hits.length === 1) return { ok: true, kind: hits[0] };
    return { ok: false, reason: `模型输出不含唯一合法形态词: "${raw.slice(0, 40)}"` };
  }

  /** 超时保护(与 IntentLlmClassifier 同款语义):超时 reject,原 promise 静默吞掉 */
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
      void guarded.catch(() => undefined);
    }
  }
}
