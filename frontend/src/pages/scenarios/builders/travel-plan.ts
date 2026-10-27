/*
 * @Description: 旅行计划时间线 builder（competitor-driven-evolution-batch Round 17）
 * 场景：自由行行程编排 —— 与既有 travel 场景（行程**流程图**）互补：
 *   travel 用泳道流程图表达「地点移动」,本场景用时间线表达「按时间推进的安排」
 *   （竞品调研 G5：时间线是旅行/排期类请求的第一直觉形态）。
 * 输入约定：每行一个安排;「Day1/D1/第1天/第一天：」开新的一天;行首时间点(09:00/上午)原样保留。
 * 产物形态：timeline（场景页拼 &form=timeline 直达）。
 */

import type { ScenarioConfig } from "../registry";

/** 行程时间线解析结果 */
export interface TravelPlanParseResult {
  days: Array<{ label: string; items: string[] }>;
  totalItems: number;
}

/** 天数行标记：Day1 / D1 / 第1天 / 第一天 / Day 1（大小写不敏感,可带冒号与当天首个安排） */
const DAY_RE = /^(?:day\s*(\d+)|d(\d+)|第([一二三四五六七八九十\d]+)天)\s*[：:-]?\s*(.*)$/i;

/** 中文数字转阿拉伯（一~十） */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 解析行程安排（纯函数）：按天分组,无天数标记的行归「行程」默认组 */
export function parseTravelPlan(raw: string): TravelPlanParseResult {
  const days: Array<{ label: string; items: string[] }> = [];
  let currentIndex = -1;
  let totalItems = 0;

  const ensureGroup = (label: string) => {
    currentIndex = days.findIndex((day) => day.label === label);
    if (currentIndex === -1) {
      days.push({ label, items: [] });
      currentIndex = days.length - 1;
    }
  };
  ensureGroup("行程");

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue;
    const dayMatch = line.match(DAY_RE);
    if (dayMatch) {
      const num =
        Number(dayMatch[1] ?? dayMatch[2]) ||
        CN_NUM[dayMatch[3] ?? ""] ||
        Number(dayMatch[3]) ||
        days.length + 1;
      ensureGroup(`Day${num}`);
      const rest = (dayMatch[4] ?? "").trim();
      if (rest) {
        days[currentIndex].items.push(rest);
        totalItems += 1;
      }
      continue;
    }
    days[currentIndex].items.push(line);
    totalItems += 1;
  }

  const pruned =
    days.length > 1 && days[0].label === "行程" && days[0].items.length === 0
      ? days.slice(1)
      : days;
  return { days: pruned, totalItems };
}

/** 解析结果 → 时间线生成指令（保留时间点原样,强调按时间先后排序） */
export function buildTravelPlanPrompt(result: TravelPlanParseResult): string {
  if (result.totalItems === 0) {
    return "帮我安排一份三天两晚的旅行时间线：按 Day 逐日给出上午/下午/晚上的安排,标注地点与移动方式";
  }
  const dayLines = result.days.map((day) => `${day.label}：${day.items.join("；")}`).join("。");
  return `帮我整理旅行时间线：${dayLines}。按时间先后排列事件,保留我给出的时间点,同一天多件事按上午/下午/晚上顺序呈现`;
}

/** 场景配置（注册到 SCENARIOS） */
export const travelPlanScenario: ScenarioConfig = {
  id: "travel-plan",
  name: "旅行计划时间线",
  tagline: "把游玩清单排成按天推进的时间线",
  emoji: "🗓️",
  maxLength: 500,
  placeholder:
    "每行一个安排,「Day1:」开新的一天。例如：\nDay1: 上午 武侯祠\nDay1: 晚上 火锅\nDay2: 大熊猫基地\nDay2: 宽窄巷子\nDay3: 返程",
  examples: [
    {
      label: "示例：成都三日",
      text: "Day1: 上午 武侯祠与锦里\nDay1: 晚上 火锅\nDay2: 上午 大熊猫基地\nDay2: 下午 宽窄巷子\nDay3: 上午 人民公园喝茶\nDay3: 下午 返程",
    },
    {
      label: "示例：周末周边游",
      text: "周六: 09:00 出发\n周六: 12:00 农家乐午餐\n周六: 15:00 登山\n周日: 10:00 古镇漫步\n周日: 16:00 返程",
    },
  ],
  buildPrompt: (text) => buildTravelPlanPrompt(parseTravelPlan(text)),
  channel: "scenario:travel-plan",
  formHint: "timeline",
};
