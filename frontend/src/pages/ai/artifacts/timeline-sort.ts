// 语图技术方案 - 时间线自然排序（competitor-driven-evolution-batch Round 7）
// 背景：timeline 的 time 是自由文本（Day1 上午 / 09:00 / 第 3 周），模型偶尔乱序输出；
//       渲染层「按时间先后」是时间线的产品承诺，需要确定性排序兜底。
// 排序键三级结构:major(天/周/日期级) → slot(时段:凌晨~深夜) → minutes(钟点)。
// 原则:纯函数、确定性(不依赖 Date.now,无年份时按固定 2000 年归一)、无法解析保持原序并如实提示。
import type { TimelineDraft, TimelineEvent } from '../../../utils/aiClient';

/** 时段序:凌晨<早上/上午<中午<下午<傍晚<晚上<深夜 */
const SLOT_WORDS: Array<[RegExp, number]> = [
  [/凌晨|清晨/, 0],
  [/早(上|间)?|上午/, 1],
  [/午(间|饭)?|中午|正午/, 2],
  [/下(午|晌)/, 3],
  [/傍晚|黄昏/, 4],
  [/晚(上|间)?|夜里|夜间/, 5],
  [/深夜|半夜|午夜/, 6],
];

export interface TimelineSortKey {
  /** 日期级主键(统一换算为「序数日」;周=周序×10000,天=天序×100,星期N=N,日期=儒略近似) */
  major: number;
  /** 时段序 0~6(无时段词时按钟点推导:6-12→上午,12-18→下午,18-24→晚上,0-6→凌晨) */
  slot: number;
  /** 一天内分钟数(09:30 → 570;无钟点为 0) */
  minutes: number;
}

/** 中文数字 → 数值(一~十/两 及组合,如 三/二十一);非中文数字返回 null */
function cnNumber(text: string): number | null {
  const direct: Record<string, number> = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  if (/^\d+$/.test(text)) return Number(text);
  if (text.length === 1) return direct[text] ?? null;
  if (text.length === 2 && text[0] === '十') return 10 + (direct[text[1]!] ?? 0);
  if (text.length === 2 && text[1] === '十') return (direct[text[0]!] ?? 0) * 10;
  if (text.length === 3 && text[1] === '十') return (direct[text[0]!] ?? 0) * 10 + (direct[text[2]!] ?? 0);
  return null;
}

/** 从时间文本解析排序键;完全无法解析返回 null(调用方保持原序) */
export function parseTimeKey(time: string): TimelineSortKey | null {
  const text = String(time ?? '').trim();
  if (!text) return null;

  // ---- 钟点:09:30 / 9点 / 14时 / 上午9:00 ----
  let minutes = 0;
  const clock = text.match(/(\d{1,2})\s*[:：点时]\s*(\d{1,2})?/);
  if (clock) {
    const h = Math.min(23, Number(clock[1]!));
    const m = clock[2] ? Math.min(59, Number(clock[2])) : 0;
    minutes = h * 60 + m;
  }

  // ---- 时段词(无则按钟点推导) ----
  let slot = -1;
  for (const [re, value] of SLOT_WORDS) {
    if (re.test(text)) {
      slot = value;
      break;
    }
  }
  if (slot < 0 && clock) {
    const h = Math.floor(minutes / 60);
    if (h < 6) slot = 0;
    else if (h < 12) slot = 1;
    else if (h < 14) slot = 2;
    else if (h < 18) slot = 3;
    else slot = 5;
  }
  const finalSlot = slot < 0 ? 0 : slot;

  // ---- 日期级主键(按优先级:显式日期 > 周序 > 天序 > 星期) ----
  // 2026-10-26 / 2026/10/26(无年份按 2000 年,保证确定性)
  const iso = text.match(/(?:(\d{4})[-/年])?\s*(\d{1,2})[-/月]\s*(\d{1,2})[日号]?/);
  if (iso) {
    const year = iso[1] ? Number(iso[1]!) : 2000;
    const month = Number(iso[2]!);
    const day = Number(iso[3]!);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { major: year * 10000 + month * 100 + day, slot: finalSlot, minutes };
    }
  }
  // 第N周 / week N
  const week = text.match(/(?:第\s*([0-9一二三四五六七八九十两]+)\s*周)|(?:week\s*(\d+))/i);
  if (week) {
    const n = week[2] ? Number(week[2]) : cnNumber(week[1]!);
    if (n !== null) return { major: n * 10000, slot: finalSlot, minutes };
  }
  // Day1 / D1 / 第1天 / 第一天 / 第N日
  const dayTok = text.match(/(?:day\s*(\d+))|(?:d\s*(\d+))|(?:第\s*([0-9一二三四五六七八九十两]+)\s*[天日])/i);
  if (dayTok) {
    const raw = dayTok[1] ?? dayTok[2] ?? dayTok[3]!;
    const n = /^\d+$/.test(raw) ? Number(raw) : cnNumber(raw);
    if (n !== null) return { major: n * 100, slot: finalSlot, minutes };
  }
  // 周一~周日 / 星期N / 礼拜N
  const weekday = text.match(/(?:星期|礼拜|周)([一二三四五六日天])/);
  if (weekday) {
    const map: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
    return { major: map[weekday[1]!]!, slot: finalSlot, minutes };
  }

  // 只有钟点/时段(无日期级标记):major=0,按 slot+minutes 排(同日场景)
  if (clock || slot >= 0) {
    return { major: 0, slot: finalSlot, minutes };
  }
  return null;
}

export interface TimelineSortResult {
  /** 排序后事件数组(新数组,不改入参);无法解析的事件保持原相对顺序排在末段 */
  events: TimelineEvent[];
  /** 是否全部解析成功 */
  allParsed: boolean;
  warnings: string[];
}

/** 时间线事件排序主入口:三级键排序 + 原序兜底(纯函数) */
export function sortTimelineEvents(draft: TimelineDraft): TimelineSortResult {
  const warnings: string[] = [];
  const keyed = draft.events.map((event, index) => {
    const key = parseTimeKey(event.time);
    if (!key) warnings.push(`时间标记「${event.time}」无法解析,保持原序置后`);
    return { event, index, key };
  });
  keyed.sort((a, b) => {
    const ka = a.key;
    const kb = b.key;
    if (!ka && !kb) return a.index - b.index;
    if (!ka) return 1; // 无键置后(保持稳定)
    if (!kb) return -1;
    if (ka.major !== kb.major) return ka.major - kb.major;
    if (ka.slot !== kb.slot) return ka.slot - kb.slot;
    if (ka.minutes !== kb.minutes) return ka.minutes - kb.minutes;
    return a.index - b.index; // 完全同键:稳定排序
  });
  return { events: keyed.map((k) => k.event), allParsed: warnings.length === 0, warnings };
}
