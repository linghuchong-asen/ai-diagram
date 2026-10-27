/*
 * @Description: 伪代码 → 流程图 builder（Round I · 编程教学场景）
 * 市场需求：流程图是编程教学的标准教具（ICSE 2025：流程图为最常用图型）——
 *   老师备课出题、教材配图、学生验证逻辑，都需要「算法步骤 → 流程图」的快速通道。
 * 输入约定：缩进式中文伪代码，支持关键字（如果/否则/当/重复/输入/输出/结束），
 *   也兼容英文关键字（if/else/while/for/input/output）。
 * 实现：结构摘要解析器（纯函数）—— 提取控制流骨架（顺序/分支/循环计数），
 *   把骨架结构化地写进生成指令，让引擎画出与伪代码拓扑一致的图。
 */

import type { ScenarioConfig } from "../registry";

/** 归一化后的伪代码行（缩进层级 + 归一关键字） */
export interface PseudoLine {
  /** 缩进层级（空格数 / 2，四舍五入） */
  indent: number;
  /** 原文（去缩进） */
  text: string;
  /** 归一化控制流类型 */
  kind: "branch" | "loop" | "io-in" | "io-out" | "plain" | "end";
}

/** 关键字识别表（中文优先，英文兼容；大小写不敏感。
 *  注意：汉字不属于 JS 正则的 word 字符，\b 在中文后不成立，
 *  故用负向前瞻 (?![a-z]) 约束英文词的边界即可，中文不受影响） */
const KIND_PATTERNS: Array<{ re: RegExp; kind: PseudoLine["kind"] }> = [
  { re: /^(如果|若|否则|反之|if|else)(?![a-z])/i, kind: "branch" },
  { re: /^(当|只要|重复|循环|while|for|repeat)(?![a-z])/i, kind: "loop" },
  { re: /^(输入|接收|获取|input|read)(?![a-z])/i, kind: "io-in" },
  { re: /^(输出|打印|返回|显示|output|print|return)(?![a-z])/i, kind: "io-out" },
  { re: /^(结束|停止|end|stop)(?![a-z])/i, kind: "end" },
];

/** 归一化一行伪代码（识别控制流类型 + 缩进层级） */
export function parsePseudoLine(rawLine: string): PseudoLine | null {
  const text = rawLine.replace(/\t/g, "  ").trim();
  if (!text || /^(\/\/|#)/.test(text)) return null; // 空行/注释行
  const indent = Math.floor((rawLine.replace(/\t/g, "  ").length - rawLine.replace(/\t/g, "  ").replace(/^ +/, "").length) / 2);
  let kind: PseudoLine["kind"] = "plain";
  for (const pattern of KIND_PATTERNS) {
    if (pattern.re.test(text)) {
      kind = pattern.kind;
      break;
    }
  }
  return { indent, text, kind };
}

/** 结构摘要：控制流骨架统计（喂给生成指令的结构信息） */
export interface PseudoSummary {
  lines: PseudoLine[];
  branchCount: number;
  loopCount: number;
  ioCount: number;
  maxIndent: number;
}

/** 解析整段伪代码 → 结构摘要（纯函数） */
export function parsePseudoCode(raw: string): PseudoSummary {
  const lines: PseudoLine[] = [];
  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const parsed = parsePseudoLine(rawLine);
    if (parsed) lines.push(parsed);
  }
  return {
    lines,
    branchCount: lines.filter((line) => line.kind === "branch").length,
    loopCount: lines.filter((line) => line.kind === "loop").length,
    ioCount: lines.filter((line) => line.kind === "io-in" || line.kind === "io-out").length,
    maxIndent: lines.reduce((max, line) => Math.max(max, line.indent), 0),
  };
}

/** 摘要 → 流程图生成指令（骨架结构显式写入，保证拓扑一致） */
export function buildPseudoPrompt(summary: PseudoSummary): string {
  const body = summary.lines.map((line) => line.text).join(" → ");
  const structureParts: string[] = [];
  if (summary.branchCount > 0) {
    structureParts.push(`含 ${summary.branchCount} 处条件分支（如果/否则用菱形判断节点，两路出口分别标注是/否）`);
  }
  if (summary.loopCount > 0) {
    structureParts.push(`含 ${summary.loopCount} 处循环（当/重复条件用菱形判断节点，循环体出口回流到循环入口）`);
  }
  if (summary.ioCount > 0) {
    structureParts.push(`含 ${summary.ioCount} 处输入输出（输入用平行四边形节点标注）`);
  }
  const structure = structureParts.length > 0 ? structureParts.join("；") : "纯顺序结构（自上而下一条主线）";
  return (
    `把以下算法伪代码画成标准流程图：${body}。结构要求：${structure}；` +
    "首尾分别用「开始」「结束」圆角节点，处理步骤用矩形，从上到下排布"
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const pseudoCodeScenario: ScenarioConfig = {
  id: "pseudo-code",
  name: "伪代码转流程图",
  tagline: "粘贴算法步骤，生成标准教学流程图",
  emoji: "👨‍🏫",
  maxLength: 500,
  placeholder:
    "粘贴缩进式伪代码，例如：\n输入两个数 a b\n如果 a > b\n  输出 a\n否则\n  输出 b\n结束",
  examples: [
    {
      label: "示例：冒泡排序（教学版）",
      text: "输入数组 arr\n重复 n-1 次\n  如果相邻两数逆序\n    交换两数\n输出排序结果",
    },
    {
      label: "示例：两数取大",
      text: "输入 a 和 b\n如果 a 大于 b\n  输出 a\n否则\n  输出 b",
    },
  ],
  buildPrompt: (text) => buildPseudoPrompt(parsePseudoCode(text)),
  channel: "scenario:pseudo-code",
};
