// 语图技术方案 - 对比表格加权打分（competitor-driven-evolution-batch Round 6）
// 定位：竞品调研发现「对比表只呈现、不打分」是全场空白——决策类痛点(选型/offer/方案)的最后一公里
//       是「权衡」，加权评分把表格从「信息陈列」升级为「决策依据」（差异化能力 G9）。
// 算法（可解释、可手算验证）：
//   ① 单元格 → 原始分：数值(含单位前缀)取数；高/中/低、优/差、快/慢等中文等级映射 1~3；
//      ★ 数量；「—」与无法解析的文本记 null(不参与,不猜测)。
//   ② 每列(≥2 个可评分单元格)做 min-max 归一化到 0~1;全列同值记 0.5(无区分度)。
//   ③ 方向翻转:列名含 成本/费用/价格/风险/工期 等语义时「越小越好」,取 1-x。
//   ④ 总分 = Σ(权重 × 归一分) / Σ权重,默认等权;按总分降序输出 + 推荐结论。
import type { TableDraft } from '../../../utils/aiClient';

/** 中文等级词 → 分数（3 高 2 中 1 低;未命中返回 null） */
const LEVEL_WORDS: Array<[RegExp, number]> = [
  [/优|高|快|多|强|好|安全/, 3],
  [/中|一般|适中/, 2],
  [/低|慢|少|弱|差|无|风险高/, 1],
];

/** 「越小越好」的列名语义（方向自动识别;调用方可覆盖） */
const LOWER_IS_BETTER = /成本|费用|价格|风险|工期|耗时|延迟|复杂度|维护量/i;

/** 星级计数:★★★ → 3 */
function countStars(text: string): number | null {
  if (!/[★☆✩]/.test(text)) return null;
  return (text.match(/[★☆✩]/g) ?? []).length;
}

/** 数值提取:'12万' '3.5' '¥99' → number;'—'/空 → null */
function extractNumber(text: string): number | null {
  const cleaned = text.replace(/[¥$￥,，\s]/g, '');
  if (!cleaned || cleaned === '—' || cleaned === '-') return null;
  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  // 纯文本里恰好含数字才可信:'无(0)' 之类含说明的按 null 处理过严,这里取首个数字
  return Number(match[0]);
}

/** 单元格 → 原始分(null = 不参与) */
export function scoreCell(cell: string): number | null {
  const text = String(cell ?? '').trim();
  if (!text || text === '—') return null;
  const stars = countStars(text);
  if (stars !== null) return stars;
  const number = extractNumber(text);
  if (number !== null && /^[-+*/().\d万亿千百%sA-Za-z¥$￥,，\s.]+$/.test(text)) return number;
  for (const [re, score] of LEVEL_WORDS) {
    if (re.test(text)) return score;
  }
  return null;
}

export interface TableScoringOptions {
  /** 列名 → 权重(默认 1);权重可为 0(剔除该列) */
  weights?: Record<string, number>;
  /** 列名 → 方向覆盖;'lower' = 越小越好 */
  direction?: Record<string, 'higher' | 'lower'>;
  /** 不参与打分的列名(如备注/说明) */
  excludeColumns?: string[];
}

export interface RowScore {
  /** 行首(对象/方案名) */
  head: string;
  /** 加权总分 0~1(可参与列的加权平均) */
  total: number;
  /** 每列明细:原始分(未归一)/归一分/是否参与 */
  breakdown: Array<{ column: string; raw: number | null; normalized: number | null }>;
}

export interface TableScoringResult {
  /** false = 可评分列不足 1 列(无法打分) */
  scored: boolean;
  /** 按总分降序 */
  rows: RowScore[];
  /** 推荐结论(可评分且存在并列最高时说明并列) */
  advice?: string;
  /** 降级明细 */
  warnings: string[];
}

/** 对比表格加权打分主入口(纯函数) */
export function scoreTable(table: TableDraft, options: TableScoringOptions = {}): TableScoringResult {
  const warnings: string[] = [];
  const [, ...dataColumns] = table.columns;
  const columnWeights = options.weights ?? {};
  const directionOverride = options.direction ?? {};
  const excluded = new Set(options.excludeColumns ?? []);

  // 参与打分的列:排除首列/显式剔除/权重为 0/无至少 2 个可评分单元格的列
  interface ColumnPlan {
    name: string;
    weight: number;
    lowerBetter: boolean;
    raws: Array<number | null>;
    min: number;
    max: number;
  }
  const plans: ColumnPlan[] = [];
  for (const name of dataColumns) {
    if (excluded.has(name)) continue;
    const weight = columnWeights[name] ?? 1;
    if (weight <= 0) continue;
    const raws = table.rows.map((row) => {
      const index = table.columns.indexOf(name);
      return index >= 0 && row[index] !== undefined ? scoreCell(row[index]!) : null;
    });
    const scoreable = raws.filter((v): v is number => v !== null);
    if (scoreable.length < 2) {
      warnings.push(`列「${name}」可评分单元格不足 2 个(或全部为「—」),已排除`);
      continue;
    }
    plans.push({
      name,
      weight,
      lowerBetter: directionOverride[name] === 'lower' || (directionOverride[name] === undefined && LOWER_IS_BETTER.test(name)),
      raws,
      min: Math.min(...scoreable),
      max: Math.max(...scoreable),
    });
  }

  if (plans.length === 0) {
    return { scored: false, rows: table.rows.map((row) => ({ head: row[0] ?? '', total: 0, breakdown: [] })), warnings: [...warnings, '没有可打分的列'] };
  }

  const rows: RowScore[] = table.rows.map((row, rowIndex) => {
    const breakdown: RowScore['breakdown'] = [];
    let weighted = 0;
    let weightSum = 0;
    for (const plan of plans) {
      const raw = plan.raws[rowIndex] ?? null;
      let normalized: number | null = null;
      if (raw !== null) {
        normalized = plan.max === plan.min ? 0.5 : (raw - plan.min) / (plan.max - plan.min);
        if (plan.lowerBetter) normalized = 1 - normalized!;
        weighted += plan.weight * normalized!;
        weightSum += plan.weight;
      }
      breakdown.push({ column: plan.name, raw, normalized });
    }
    return { head: row[0] ?? `第${rowIndex + 1}行`, total: weightSum > 0 ? weighted / weightSum : 0, breakdown };
  });

  for (const plan of plans) {
    if (plan.min === plan.max) warnings.push(`列「${plan.name}」各行取值相同(无区分度,按 0.5 计)`);
  }

  rows.sort((a, b) => b.total - a.total);
  const top = rows[0]!;
  const tied = rows.filter((r) => Math.abs(r.total - top.total) < 1e-9);
  const advice =
    tied.length > 1
      ? `综合加权并列最高: ${tied.map((r) => r.head).join('、')}(均 ${top.total.toFixed(2)} 分),建议补充关键维度再决策`
      : `综合加权得分最高: ${top.head}(${top.total.toFixed(2)} 分)`;

  return { scored: true, rows, advice, warnings };
}
