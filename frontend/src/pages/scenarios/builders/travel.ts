/*
 * @Description: 旅行行程图 builder（Round K）
 * 市场需求：小红书「行程路线图/旅行攻略图」是常青爆款内容（调研：可画专为小红书建场景页）——
 *   游客做攻略、博主发笔记都需要一张按天分组的行程图。
 * 输入约定：每行一个安排，「Day1/D1/第1天/第一天：」开头的行开新的一天组；
 *   地点→地点的移动用「→」分隔；无天数标记的行归「行程」默认组。
 */

import type { ScenarioConfig } from "../registry";

/** 行程解析结果：按天分组的活动序列 */
export interface ItineraryParseResult {
  days: Array<{ label: string; items: string[] }>;
  /** 识别出的移动路线（含 → 的行），用于指令中强调连线 */
  moves: string[];
  totalItems: number;
}

/** 天数行标记：Day1 / D1 / 第1天 / 第一天 / Day 1（大小写不敏感） */
const DAY_RE = /^(?:day\s*(\d+)|d(\d+)|第([一二三四五六七八九十\d]+)天)\s*[：:-]?\s*(.*)$/i;

/** 中文数字转阿拉伯（一~十） */
const CN_NUM: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

/** 解析行程清单（纯函数） */
export function parseItinerary(raw: string): ItineraryParseResult {
  const days: Array<{ label: string; items: string[] }> = [];
  const moves: string[] = [];
  let totalItems = 0;
  let currentLabel = "行程";
  let currentIndex = -1;

  const ensureGroup = (label: string) => {
    currentIndex = days.findIndex((day) => day.label === label);
    if (currentIndex === -1) {
      days.push({ label, items: [] });
      currentIndex = days.length - 1;
    }
  };
  ensureGroup(currentLabel);

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
      currentLabel = `Day${num}`;
      ensureGroup(currentLabel);
      const rest = (dayMatch[4] ?? "").trim();
      if (rest) {
        days[currentIndex].items.push(rest);
        totalItems += 1;
        if (rest.includes("→")) moves.push(rest);
      }
      continue;
    }
    days[currentIndex].items.push(line);
    totalItems += 1;
    if (line.includes("→")) moves.push(line);
  }

  // 清理从未落内容的空默认组（仅当还存在其他组时；全空输入保留默认组兜底）
  const prunedDays =
    days.length > 1 && days[0].label === "行程" && days[0].items.length === 0
      ? days.slice(1)
      : days;

  return { days: prunedDays, moves, totalItems };
}

/** 解析结果 → 行程图生成指令（按天泳道 + 移动连线强调） */
export function buildItineraryPrompt(result: ItineraryParseResult): string {
  const dayLines = result.days
    .map((day) => `${day.label}：${day.items.join(" → ")}`)
    .join("；");
  return (
    `画一张旅行行程流程图：按天分组呈现，${dayLines}。` +
    "每天作为一条横向泳道（泳道标签为天数），泳道内按时间顺序串联当日地点与活动节点；" +
    "地点之间的移动用带箭头连线连接并保持顺序；最后加「返程」结束节点"
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const travelScenario: ScenarioConfig = {
  id: "travel",
  name: "旅行行程图",
  tagline: "把攻略清单变成按天分组的行程路线图",
  emoji: "🧳",
  maxLength: 500,
  placeholder:
    "每行一个安排，「Day1:」开新的一天，例如：\nDay1: 机场 → 酒店 → 外滩夜景\nDay2: 迪士尼一整天 → 烟花表演\nDay3: 武康路 → 返程",
  examples: [
    {
      label: "示例：上海三日游",
      text: "Day1: 虹桥机场 → 酒店 → 南京路 → 外滩夜景\nDay2: 迪士尼乐园一整天 → 城堡烟花\nDay3: 武康路逛吃 → 豫园 → 返程",
    },
  ],
  buildPrompt: (text) => buildItineraryPrompt(parseItinerary(text)),
  channel: "scenario:travel",
};
