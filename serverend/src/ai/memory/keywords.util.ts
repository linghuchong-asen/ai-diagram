// 语图技术方案 - 轻量关键词抽取(Task 10.2 双路召回的关键词路)
// 约束:不引入任何新依赖(无 jieba / 无分词服务),纯规则实现:
//   1) 领域词表命中(业务流程域:请假/审批/报销/节点/网关…),权重最高;
//   2) ASCII 词(英文标识符、字段名、工具名),小写归一并过滤停用词;
//   3) 中文串的字二元组(bigram)兜底 —— 无分词器时对中文召回最有效,
//      且与 keywordScore 的 `query.includes(kw)` 语义天然契合。
// 用途:长期记忆写入时生成 keywords;话题切换检测的关键词兜底路。
// 说明:抽取结果按「词表 > ASCII > bigram」优先级去重并封顶,避免关键词膨胀。

/** 业务流程域词表(命中即作为关键词,比 bigram 更精确) */
export const DOMAIN_LEXICON: string[] = [
  // 业务动作/流程
  '请假',
  '审批',
  '审批流程',
  '报销',
  '费用报销',
  '招聘',
  '入职',
  '离职',
  '采购',
  '下单',
  '退款',
  '退货',
  '支付',
  '结算',
  '开票',
  '合同',
  '立项',
  '评审',
  '发布',
  '部署',
  '上线',
  '回滚',
  '注册',
  '登录',
  '登出',
  '鉴权',
  '授权',
  '测试',
  '验收',
  '归档',
  '流程',
  '节点',
  '网关',
  '分支',
  '条件',
  '开始节点',
  '结束节点',
  '并行',
  '串行',
  '子流程',
  '待办',
  '抄送',
  '驳回',
  '撤回',
  '提交',
  '审核',
  '复核',
  '签署',
  // 角色
  '提交人',
  '申请人',
  '负责人',
  '经办人',
  '审批人',
  '部门经理',
  '主管',
  '财务',
  '人事',
  '管理员',
];

/** ASCII 停用词(对召回无信息量) */
export const KEYWORD_STOPWORDS: string[] = [
  'the',
  'a',
  'an',
  'and',
  'or',
  'of',
  'to',
  'in',
  'on',
  'for',
  'with',
  'is',
  'are',
  'be',
  'this',
  'that',
  'it',
  'as',
  'at',
  'by',
  'from',
  'if',
  'then',
  'else',
  'not',
  'no',
  'yes',
  'please',
  'help',
  'me',
  'my',
  'you',
  'your',
  'we',
  'i',
  'do',
  'can',
  'will',
  'would',
  'should',
  'have',
  'has',
  'was',
  'were',
];

/** 中文语气/助词 bigram 黑名单(避免无信息量的二元组占据配额) */
const CJK_PARTICLES = /[的了呢吗啊吧呀哦嗯是在和与或就都也很还要不没给对把被让向从到]/;

export interface ExtractKeywordsOptions {
  /** 关键词上限(默认 16) */
  limit?: number;
  /** 是否生成中文字二元组兜底(默认 true) */
  bigrams?: boolean;
  /** 单个关键词最大长度(默认 24) */
  maxLength?: number;
}

const DEFAULT_LIMIT = 16;
const DEFAULT_MAX_LENGTH = 24;
/** 中文串至少 2 字才参与 bigram */
const MIN_CJK_RUN = 2;
/** ASCII 词至少 2 字符 */
const MIN_ASCII_TOKEN = 2;

/**
 * 轻量关键词抽取:词表命中 → ASCII 词 → 中文字二元组,去重后封顶。
 * 纯函数,便于单测;对空输入返回空数组,不抛异常。
 */
export function extractKeywordsLite(text: string, options: ExtractKeywordsOptions = {}): string[] {
  const source = typeof text === 'string' ? text : '';
  if (!source.trim()) return [];

  const limit = options.limit ?? DEFAULT_LIMIT;
  const maxLength = options.maxLength ?? DEFAULT_MAX_LENGTH;
  const useBigrams = options.bigrams !== false;

  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | undefined | null) => {
    const kw = (value ?? '').trim().slice(0, maxLength);
    if (!kw) return;
    const key = kw.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    ordered.push(kw);
  };

  // 1) 领域词表:长词优先(先"审批流程"再"审批"),避免短词遮蔽长词
  const lexicon = [...DOMAIN_LEXICON].sort((a, b) => b.length - a.length);
  for (const term of lexicon) {
    if (ordered.length >= limit) break;
    if (source.includes(term)) push(term);
  }

  // 2) ASCII 词(英文/标识符/数字组合)
  for (const m of source.matchAll(/[A-Za-z][A-Za-z0-9_\-]{1,}|[A-Za-z0-9_\-]{2,}/g)) {
    if (ordered.length >= limit) break;
    const token = m[0];
    if (!token || token.length < MIN_ASCII_TOKEN) continue;
    const lower = token.toLowerCase();
    if (KEYWORD_STOPWORDS.includes(lower)) continue;
    push(token);
  }

  // 3) 中文串:先整体(≥2 且 ≤8 字的短词直接作为关键词),再 bigram 兜底
  const cjkRuns = source.match(/[\u4e00-\u9fa5]{2,}/g) ?? [];
  for (const run of cjkRuns) {
    if (ordered.length >= limit) break;
    if (run.length >= MIN_CJK_RUN && run.length <= 8 && !hasLexiconHit(run)) push(run);
  }
  if (useBigrams) {
    for (const run of cjkRuns) {
      if (ordered.length >= limit) break;
      for (let i = 0; i + 2 <= run.length; i++) {
        if (ordered.length >= limit) break;
        const bigram = run.slice(i, i + 2);
        // 跨词边界的助词组合信息量低,丢弃
        if (CJK_PARTICLES.test(bigram)) continue;
        push(bigram);
      }
    }
  }

  return ordered.slice(0, limit);
}

/**
 * 关键词路召回打分辅助:候选关键词在查询文本中的命中数。
 * 与 long-term.store.ts 的 keywordScore 语义一致(小写包含匹配),
 * 单独导出便于在无记忆记录的场景(如话题切换)复用。
 */
export function countKeywordHits(keywords: string[] | undefined, query: string): number {
  const q = (query ?? '').toLowerCase();
  if (!q) return 0;
  return (keywords ?? []).reduce(
    (acc, kw) => (kw && q.includes(String(kw).toLowerCase()) ? acc + 1 : acc),
    0,
  );
}

/** 关键词集合的 Jaccard 相似度(话题切换兜底路复用) */
export function jaccard(a: string[] | undefined, b: string[] | undefined): number {
  const left = new Set((a ?? []).map((x) => String(x).toLowerCase()).filter(Boolean));
  const right = new Set((b ?? []).map((x) => String(x).toLowerCase()).filter(Boolean));
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const k of left) if (right.has(k)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function hasLexiconHit(run: string): boolean {
  return DOMAIN_LEXICON.some((term) => term.length >= run.length && run.includes(term));
}
