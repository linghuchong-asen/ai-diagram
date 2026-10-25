// 语图技术方案 - Prompt 注入防御(Task 11.6)
// 文档(security.md 输入安全):分层防御 —— 输入预处理(模式过滤)命中时「清洗或拒绝」,
//   System Prompt 首尾角色锚定兜底,输出侧 Zod + 图结构校验最终拦截。
// 本模块只做第一层:纯函数、无依赖,便于单测与在意图识别前接入。
// 措辞纪律:拒绝时返回受控话术(INJECTION_REFUSAL),不向用户复述命中了什么规则(避免被当探测 oracle)。

export interface InjectionFilterResult {
  /** allow = 放行;sanitize = 剔除命中句后放行;reject = 直接拒绝 */
  action: 'allow' | 'sanitize' | 'reject';
  /** 处理后的用户输入(reject 时为空串) */
  text: string;
  /** 命中的模式名(仅供日志/trace,不透出给用户) */
  hits: string[];
}

/** 受控拒绝话术:固定措辞,不给模型/用户自由发挥空间 */
export const INJECTION_REFUSAL = '您的请求包含无法处理的内容。请重新描述您的流程图需求，例如「帮我生成一个请假审批流程」。';

/**
 * 注入模式表:按强度分级。
 *  - REJECT:典型指令覆盖/角色劫持/提示词套取,命中即拒;
 *  - STRIP :可疑句式(引用系统设定的对话片段等),命中剔除该句后放行。
 */
export const INJECTION_PATTERNS: Array<{ name: string; level: 'reject' | 'strip'; re: RegExp }> = [
  // ---- 指令覆盖(中) ----
  {
    name: 'override-zh',
    level: 'reject',
    re: /(忽略|无视|跳过|丢弃|不要遵守|不用遵守)(?:以上|上面|之前|前面|先前|所有|全部|的|你){0,6}(指令|提示词|提示|规则|设定|约束|要求)/,
  },
  {
    name: 'override-en',
    level: 'reject',
    re: /ignore\s+(?:all\s+)?(?:previous|prior|above|earlier|the)\s+(?:instructions?|prompts?|rules?|constraints?)/i,
  },
  {
    name: 'disregard-en',
    level: 'reject',
    re: /disregard\s+(?:all\s+|your\s+|the\s+)*(?:previous|prior|above|earlier)\s+(?:instructions?|prompts?|rules?)/i,
  },
  // ---- 角色劫持 ----
  {
    name: 'role-hijack-zh',
    level: 'reject',
    re: /(从现在开始|现在开始|从即刻起)(你是|你扮演|你将扮演|你就是)/,
  },
  {
    name: 'role-hijack-en',
    level: 'reject',
    re: /\b(?:you\s+are\s+now|act\s+as|pretend\s+to\s+be|behave\s+as)\s+(?:a|an|the)?\s*(?:different|new|another|dan|jailbreak|unrestricted|evil)/i,
  },
  // ---- 系统提示词套取(谓语前置:输出你的系统提示词) ----
  {
    name: 'prompt-extract-zh',
    level: 'reject',
    re: /(输出|打印|显示|告诉我|泄露|复述|重复|说出)(一下|下)?(你的|系统的|上面|之前的?)?(完整)?(系统提示词|系统指令|system\s*prompt|初始指令|完整提示词|隐藏指令)/i,
  },
  // ---- 系统提示词套取(宾语前置:把你的系统提示词输出给我) ----
  {
    name: 'prompt-extract-zh-obj-first',
    level: 'reject',
    re: /(系统提示词|系统指令|system\s*prompt|初始指令|隐藏指令)[^。;;\n]{0,8}?(输出|打印|显示|发给我|给我看|泄露|复述|重复|透露|告诉我)/i,
  },
  {
    name: 'prompt-extract-en',
    level: 'reject',
    re: /(reveal|print|show|repeat|output|leak)\s+(your|the)\s+(system\s+prompt|initial\s+instructions?|hidden\s+instructions?)/i,
  },
  // ---- 伪系统标记/分隔符伪装 ----
  {
    name: 'fake-system-markup',
    level: 'reject',
    re: /<\/?system>|<\/?instructions?>|\[system\]|\(system\)|SYSTEM\s*:\s*[「"'「]?你/i,
  },
  // ---- 可疑但可清洗:引用/扮演系统设定对话 ----
  {
    name: 'fake-dialog-zh',
    level: 'strip',
    re: /^(系统|system|助手|assistant)\s*[:：]/i,
  },
  {
    name: 'new-rules-zh',
    level: 'strip',
    re: /(新的?|另外|补充)?(规则|指令)\s*[:：]\s*从现在起/,
  },
];

/** 中文/英文通用的句子切分(保留分隔符语义,剔除时按句丢弃) */
function splitSentences(text: string): string[] {
  return (text ?? '')
    .split(/(?<=[。！？!?;；\n])|\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 用户输入注入过滤(意图识别前调用):
 *  - 命中 reject 级模式 → 整体拒绝(返回受控话术由调用方使用);
 *  - 仅命中 strip 级模式 → 剔除命中句后放行(保住正常需求,如句中夹带注入);
 *  - 无命中 → 原样放行。
 */
export function filterUserInput(input: string): InjectionFilterResult {
  const text = String(input ?? '');
  if (!text.trim()) {
    return { action: 'allow', text, hits: [] };
  }

  const hits: string[] = [];
  let rejected = false;

  for (const { name, level, re } of INJECTION_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) {
      hits.push(name);
      if (level === 'reject') rejected = true;
    }
  }
  if (rejected) {
    return { action: 'reject', text: '', hits };
  }

  if (hits.length === 0) {
    return { action: 'allow', text, hits: [] };
  }

  // strip 级:剔除命中句,剩余内容放行;若全部句被剔除则视为拒绝
  const kept = splitSentences(text).filter((sentence) => {
    return !INJECTION_PATTERNS.some(({ re }) => {
      re.lastIndex = 0;
      return re.test(sentence);
    });
  });
  if (kept.length === 0) {
    return { action: 'reject', text: '', hits };
  }
  return { action: 'sanitize', text: kept.join(' '), hits };
}

/**
 * 判断一段文本是否含注入模式(供日志/审计侧断言,不做改写)。
 */
export function isPromptInjection(text: string): boolean {
  return filterUserInput(text).action === 'reject';
}
