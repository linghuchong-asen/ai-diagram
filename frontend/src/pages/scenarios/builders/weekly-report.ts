/*
 * @Description: 周报一图流 builder（Round G 首个场景）
 * 市场需求：周报是职场刚需文化 —— 每周五把零散事项整理成图发群里，比文字周报更直观。
 * 输入约定（宽松）：每行一个事项，行首用「【项目名】」或「项目名：」标记分组，
 *   无分组标记的行归入「其他事项」；空行与纯符号行忽略。
 * 输出：分组结构的周报流程图生成指令（每组一条主干 + 事项串联 + 下周计划分支）。
 */

import type { ScenarioConfig } from "../registry";

/** 解析结果：按项目分组的事项（保持输入顺序） */
export interface WeeklyParseResult {
  groups: Array<{ name: string; items: string[] }>;
  /** 无分组标记的事项落入「其他事项」（仅当存在此类行时出现该组） */
  totalItems: number;
}

/** 行首分组标记：【项目名】xxx 或 项目名：xxx */
const BRACKET_RE = /^【([^】]{1,20})】\s*(.*)$/;
const COLON_RE = /^([\u4e00-\u9fa5A-Za-z0-9_-]{1,20})[：:]\s*(.+)$/;

/**
 * 解析周报事项清单（纯函数）。
 * 规则：逐行清洗 → 匹配分组标记开新组（同名组归并）→ 无标记行入当前组或「其他事项」。
 */
export function parseWeeklyItems(raw: string): WeeklyParseResult {
  const groups = new Map<string, string[]>();
  let currentGroup = "其他事项";
  let totalItems = 0;

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue; // 空行/纯符号分隔行忽略

    const bracket = line.match(BRACKET_RE);
    if (bracket) {
      currentGroup = bracket[1].trim();
      const rest = bracket[2].trim();
      if (rest) {
        if (!groups.has(currentGroup)) groups.set(currentGroup, []);
        groups.get(currentGroup)!.push(rest);
        totalItems += 1;
      }
      continue;
    }
    const colon = line.match(COLON_RE);
    // 「项目名：事项」视为开新组；但值为纯数字/百分比的属性行（如「进度：60%」「完成：50%」）
    // 不开组 —— 判定标准看冒号后的值是否为量词型短值
    if (colon && !/^[\d.,%\s]+%?$/.test(colon[2])) {
      currentGroup = colon[1].trim();
      const rest = colon[2].trim();
      if (rest) {
        if (!groups.has(currentGroup)) groups.set(currentGroup, []);
        groups.get(currentGroup)!.push(rest);
        totalItems += 1;
      }
      continue;
    }
    if (!groups.has(currentGroup)) groups.set(currentGroup, []);
    groups.get(currentGroup)!.push(line);
    totalItems += 1;
  }

  return {
    groups: [...groups.entries()].map(([name, items]) => ({ name, items })),
    totalItems,
  };
}

/** 解析结果 → 周报流程图生成指令（分组主干 + 事项串联 + 复盘/下周计划收尾） */
export function buildWeeklyPrompt(result: WeeklyParseResult): string {
  const groupLines = result.groups
    .map((group) => `${group.name}：${group.items.join(" → ")}`)
    .join("；");
  return (
    `画一张本周工作周报流程图：按项目分组呈现，${groupLines}；` +
    "每个项目组的事项按顺序串联为一条主线，全部项目汇入「本周复盘」节点，" +
    "复盘后接「下周计划」节点（含继续推进/调整方向/暂缓三个分支）"
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const weeklyReportScenario: ScenarioConfig = {
  id: "weekly-report",
  name: "周报一图流",
  tagline: "把本周零散事项整理成一张项目分组周报图",
  emoji: "📋",
  maxLength: 500,
  placeholder:
    "每行一件事，行首可用【项目名】分组，例如：\n【官网改版】完成首页设计稿\n【官网改版】前端开发 60%\n用户群：处理了 3 个反馈",
  examples: [
    {
      label: "示例：互联网打工人周报",
      text: "【官网改版】完成首页设计稿并评审通过\n【官网改版】前端静态页开发 60%\n【数据平台】接入了新的埋点事件\n处理了 3 个用户反馈\n写了一篇技术分享",
    },
  ],
  buildPrompt: (text) => buildWeeklyPrompt(parseWeeklyItems(text)),
  channel: "scenario:weekly-report",
};
