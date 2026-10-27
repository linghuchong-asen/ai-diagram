/*
 * @Description: OKR 拆解图 builder（Round P）
 * 市场需求：季度规划/年终述职的 OKR 文化刚需 —— 「O 定了，KR 怎么拆、动作怎么排」
 *   是管理者的常规动作，拆解树正是 OKR 的原生形态（O 为根，KR 为枝，动作为叶）。
 * 输入约定：
 *   「O：提升用户留存」目标行（可多 O）
 *   「KR1/KR-/·」开头的行是对应 O 的关键结果（归属其上方最近的 O）
 *   其余缩进行视为达成动作，归属最近的 KR
 */

import type { ScenarioConfig } from "../registry";

/** OKR 解析结果 */
export interface OkrParseResult {
  objectives: Array<{
    text: string;
    keyResults: Array<{ text: string; actions: string[] }>;
  }>;
  /** 未归属任何 O 的孤立 KR/行（提示用户补 O） */
  orphans: string[];
}

/** O 行标记 */
const OBJECTIVE_RE = /^(?:O|目标|objective)\s*\d*\s*[：:]\s*(.+)$/i;
/** KR 行标记（KR1/KR-/关键结果：） */
const KR_RE = /^(?:KR\s*\d*|关键结果)\s*[：:-]?\s*(.+)$/i;

/** 解析 OKR 文本（纯函数） */
export function parseOkr(raw: string): OkrParseResult {
  const result: OkrParseResult = { objectives: [], orphans: [] };
  let currentO: OkrParseResult["objectives"][number] | null = null;
  let currentKr: { text: string; actions: string[] } | null = null;

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue;

    const oMatch = line.match(OBJECTIVE_RE);
    if (oMatch) {
      currentO = { text: oMatch[1].trim(), keyResults: [] };
      result.objectives.push(currentO);
      currentKr = null;
      continue;
    }
    const krMatch = line.match(KR_RE);
    if (krMatch) {
      const kr = { text: krMatch[1].trim(), actions: [] };
      if (currentO) {
        currentO.keyResults.push(kr);
        currentKr = kr;
      } else {
        result.orphans.push(kr.text);
      }
      continue;
    }
    // 普通行：有当前 KR 归动作；否则有当前 O 归为该 O 的 KR（无前缀写法）；否则孤立
    if (currentKr) {
      currentKr.actions.push(line);
    } else if (currentO) {
      const kr = { text: line, actions: [] };
      currentO.keyResults.push(kr);
      currentKr = kr;
    } else {
      result.orphans.push(line);
    }
  }
  return result;
}

/** 解析结果 → OKR 拆解树生成指令 */
export function buildOkrPrompt(result: OkrParseResult): string {
  if (result.objectives.length === 0) {
    return (
      "画一张 OKR 拆解树流程图（模板）：根节点为「目标 O」，第二层为 3 个关键结果 KR1-KR3，" +
      "每个 KR 下挂 2-3 个执行动作叶节点，动作节点旁标注负责人与截止时间的占位文本"
    );
  }
  const objectiveLines = result.objectives
    .map((objective) => {
      const krPart =
        objective.keyResults.length > 0
          ? objective.keyResults
              .map((kr) => `${kr.text}${kr.actions.length > 0 ? `（动作：${kr.actions.join("、")}）` : ""}`)
              .join("；")
          : "KR 待补充";
      return `目标「${objective.text}」的关键结果：${krPart}`;
    })
    .join("。");
  const orphanPart =
    result.orphans.length > 0
      ? `另有未归属目标的内容（请作为独立分支挂在旁边并标注「待归类」）：${result.orphans.join("；")}`
      : "";
  return (
    `画一张 OKR 拆解树流程图：树根为「季度 OKR」，第一层分支为各目标 O，第二层为关键结果 KR，` +
    `第三层为执行动作叶节点。${objectiveLines}。${orphanPart}` +
    "每个 KR 节点旁预留「置信度/进度」标注位，叶节点用浅色小节点与 KR 区分层级"
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const okrScenario: ScenarioConfig = {
  id: "okr",
  name: "OKR 拆解图",
  tagline: "O 与 KR 一贴，生成季度拆解树",
  emoji: "🎯",
  maxLength: 500,
  placeholder:
    "O：提升注册转化率\nKR1：落地页改版\n  动作：A/B 测试新首屏\nKR2：注册流程简化到两步\nKR3：新增邀请返额度",
  examples: [
    {
      label: "示例：增长团队 OKR",
      text: "O：Q4 提升付费转化率\nKR1：付费页改版并 A/B 测试\n  动作：新版价格表\n  动作：首单优惠实验\nKR2：新手引导缩短到 3 步\nKR3：召回沉默用户 5000 名",
    },
  ],
  buildPrompt: (text) => buildOkrPrompt(parseOkr(text)),
  channel: "scenario:okr",
};
