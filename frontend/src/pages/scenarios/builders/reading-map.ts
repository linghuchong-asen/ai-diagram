/*
 * @Description: 读书导图 builder（competitor-driven-evolution-batch Round 17）
 * 场景：读书记笔记 / 一本书的知识体系整理 —— 层级发散是思维导图形态的本命场景
 *   （竞品调研 G9：markmap 的核心用例就是 Markdown 笔记转脑图;语图把入口做成场景页）。
 * 输入约定：第一行书名（可带《》,也可省略——解析时智能识别）;其后每行一个要点/人物/情节线索。
 * 产物形态：mindmap（场景页拼 &form=mindmap 直达）。
 */

import type { ScenarioConfig } from "../registry";

/** 读书导图解析结果 */
export interface ReadingMapParseResult {
  /** 书名（首行去书名号后;空则空串,由 buildPrompt 降级为通用请求） */
  book: string;
  /** 其余行：用户提供的分支线索 */
  points: string[];
}

/** 书名号提取 《书名》 */
const BOOK_TITLE_RE = /《([^》]+)》/;

/** 解析读书输入（纯函数）：优先取书名号内的书名;否则首行视为书名 */
export function parseReadingMap(raw: string): ReadingMapParseResult {
  const lines = String(raw ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !/^[-—_=*·]+$/.test(line));
  if (lines.length === 0) return { book: "", points: [] };

  // 优先从全文找《》书名;没有则以首行为书名
  const joined = lines.join("\n");
  const titleMatch = joined.match(BOOK_TITLE_RE);
  if (titleMatch) {
    const book = titleMatch[1].trim();
    // 书名所在行如还带其他要点,拆分后保留
    const points = lines
      .filter((line) => !line.includes(`《${book}》`))
      .concat(
        lines
          .filter((line) => line.includes(`《${book}》`))
          .map((line) => line.replace(`《${book}》`, "").trim())
          .filter(Boolean),
      );
    return { book, points };
  }
  const [first, ...rest] = lines;
  return { book: first, points: rest };
}

/** 解析结果 → 思维导图生成指令（书名 + 分支线索,要求层级发散） */
export function buildReadingMapPrompt(result: ReadingMapParseResult): string {
  const bookPart = result.book ? `《${result.book.replace(/[《》]/g, "")}》` : "这本书";
  const pointPart = result.points.length
    ? `重点整理：${result.points.join("、")}`
    : "按背景脉络、核心人物、经典情节、主题思想四个分支展开";
  return `把${bookPart}整理成思维导图：${pointPart}。要求层级清楚、同层节点语义独立,每个分支向下再拆 2~3 层`;
}

/** 场景配置（注册到 SCENARIOS） */
export const readingMapScenario: ScenarioConfig = {
  id: "reading-map",
  name: "读书笔记导图",
  tagline: "把一本书拆成层级清晰的知识导图",
  emoji: "📚",
  maxLength: 500,
  placeholder:
    "第一行写书名,其后每行一个要点/分支线索。例如：\n《红楼梦》\n四大家族关系\n主要人物\n经典情节",
  examples: [
    {
      label: "示例：红楼梦",
      text: "《红楼梦》\n四大家族关系\n主要人物\n经典情节\n主题思想",
    },
    {
      label: "示例：原则",
      text: "《原则》\n生活原则\n工作原则\n决策方法",
    },
  ],
  buildPrompt: (text) => buildReadingMapPrompt(parseReadingMap(text)),
  channel: "scenario:reading-map",
  formHint: "mindmap",
};
