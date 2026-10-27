/*
 * @Description: 方案对比表 builder（competitor-driven-evolution-batch Round 17）
 * 场景：技术选型 / 方案对比 / 产品横评 —— 多对象多维度比较是表格形态的本命场景
 *   （竞品调研 G9：Lucidchart/Whimsical 均以 comparison matrix 为高频模板）。
 * 输入约定：第一行 = 待对比对象（顿号/逗号/斜杠/vs 分隔）；其后每行一个关注维度或补充说明。
 * 产物形态：table（场景页拼 &form=table 直达,FormRouter 零路由）。
 */

import type { ScenarioConfig } from "../registry";

/** 对比输入解析结果 */
export interface ComparisonParseResult {
  /** 待对比对象（≥2 个才构成对比;不足时由 buildPrompt 降级为自由描述） */
  subjects: string[];
  /** 其余行：优先按「用户点名维度」消费（短词行），长句作为补充说明 */
  extraLines: string[];
}

/** 对象分隔符：顿号/逗号/斜杠/竖线/空格分隔,以及中英 vs */
const SUBJECT_SPLIT_RE = /\s*(?:[、,，/|]|&|\bvs\.?\b|\bversus\b)\s*/i;

/** 解析对比输入（纯函数）：首行拆对象,其余行原样保留 */
export function parseComparison(raw: string): ComparisonParseResult {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-—_=*·]+$/.test(line));
  const first = lines.shift() ?? "";
  const subjects = first
    .split(SUBJECT_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  return { subjects, extraLines: lines };
}

/** 解析结果 → 对比表生成指令（维度点名 + 推荐结论要求） */
export function buildComparisonPrompt(result: ComparisonParseResult): string {
  // 对象不足两个：无法构成对比,让 LLM 按自由文本理解（仍固定 table 形态,由 formHint 保证）
  if (result.subjects.length < 2) {
    const text = [result.subjects.join(""), ...result.extraLines].filter(Boolean).join("；");
    return `帮我做一张方案对比表：${text || '（未提供内容）'}。请提炼出 2~3 个待比对象,从成本、工期、维护性、风险等维度展开对比,最后给出推荐结论`;
  }
  const subjectText = result.subjects.map((s) => `「${s}」`).join("和");
  const dimensions = result.extraLines.filter((line) => line.length <= 12);
  const notes = result.extraLines.filter((line) => line.length > 12);
  const dimensionClause = dimensions.length
    ? `重点对比这些维度：${dimensions.join("、")}`
    : "从成本、工期、维护性、风险等维度展开";
  const noteClause = notes.length ? `。补充背景：${notes.join("；")}` : "";
  return `帮我对比${subjectText}：${dimensionClause}${noteClause}。请输出对比表格,最后给出推荐结论`;
}

/** 场景配置（注册到 SCENARIOS） */
export const comparisonScenario: ScenarioConfig = {
  id: "comparison",
  name: "方案对比表",
  tagline: "把选型纠结变成多维度对比表 + 推荐结论",
  emoji: "⚖️",
  maxLength: 500,
  placeholder:
    "第一行写待对比对象（顿号/逗号/vs 分隔），其后每行一个关注维度。例如：\n自建 vs 采购\n成本\n工期\n维保",
  examples: [
    {
      label: "示例：自建 vs 采购",
      text: "自建 vs 采购\n成本\n工期\n维护性\n风险\n团队只有 3 个后端,项目要求 2 个月内上线",
    },
    {
      label: "示例：三个云厂商",
      text: "阿里云、腾讯云、华为云\n价格\n稳定性\n生态",
    },
  ],
  buildPrompt: (text) => buildComparisonPrompt(parseComparison(text)),
  channel: "scenario:comparison",
  formHint: "table",
};
