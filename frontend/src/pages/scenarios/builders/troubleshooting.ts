/*
 * @Description: 故障排查 SOP 图 builder（Round M）
 * 市场需求：IT 支持/客服/运维的排查 SOP 是刚需文档 —— 一线人员需要的不是文章，
 *   而是「现象 → 逐步排查 → 分支判定 → 根因 → 解决」的决策树，画成图即可执行。
 * 输入约定：按段标签组织，「现象：」「排查：」「根因：」「解决：」「升级：」各占一段；
 *   「排查：」段内每行一个排查步骤（行内「则/如果」被视为分支条件由引擎展开）。
 */

import type { ScenarioConfig } from "../registry";

/** SOP 段落标签 → 归一 key */
type SopSection = "symptom" | "steps" | "rootCause" | "resolution" | "escalation";

const SECTION_MAP: Array<{ re: RegExp; key: SopSection }> = [
  { re: /^(现象|故障|问题|告警)\s*[：:]/, key: "symptom" },
  { re: /^(排查|诊断|检查)\s*[：:]/, key: "steps" },
  { re: /^(根因|原因)\s*[：:]/, key: "rootCause" },
  { re: /^(解决|处置|修复)\s*[：:]/, key: "resolution" },
  { re: /^(升级|上报)\s*[：:]/, key: "escalation" },
];

/** SOP 解析结果 */
export interface SopParseResult {
  symptom: string[];
  steps: string[];
  rootCause: string[];
  resolution: string[];
  escalation: string[];
  /** 未带标签的行（提示用户补标签，不丢弃） */
  unlabeled: string[];
}

/** 解析 SOP 文本（纯函数）：段标签开新段，段内每行一条目 */
export function parseSop(raw: string): SopParseResult {
  const result: SopParseResult = {
    symptom: [], steps: [], rootCause: [], resolution: [], escalation: [], unlabeled: [],
  };
  let current: keyof SopParseResult = "unlabeled";

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue;

    let matched = false;
    for (const section of SECTION_MAP) {
      if (section.re.test(line)) {
        current = section.key;
        const rest = line.replace(section.re, "").trim();
        if (rest) result[current].push(rest);
        matched = true;
        break;
      }
    }
    if (!matched) {
      result[current].push(line);
    }
  }
  return result;
}

/** 解析结果 → 排查决策树生成指令 */
export function buildSopPrompt(result: SopParseResult): string {
  const symptomPart =
    result.symptom.length > 0 ? `故障现象：${result.symptom.join("；")}` : "故障现象：按输入内容自行归纳";
  const stepsPart =
    result.steps.length > 0
      ? `排查步骤：${result.steps.join(" → ")}（每一步用菱形判断节点，是/否两个出口：是则进入下一步，否则跳到对应分支处理）`
      : "排查步骤：按输入行顺序展开为判断链";
  const rootPart = result.rootCause.length > 0 ? `常见根因：${result.rootCause.join("；")}` : "";
  const fixPart = result.resolution.length > 0 ? `解决方案：${result.resolution.join("；")}` : "";
  const escPart = result.escalation.length > 0 ? `升级路径：${result.escalation.join("；")}` : "";
  return (
    `画一张故障排查 SOP 决策树流程图。${symptomPart}。${stepsPart}。` +
    `排查全部未命中则进入「按根因清单逐项验证」环节（${rootPart || "根因待补充"}），` +
    `命中根因后执行对应解决动作（${fixPart || "解决方案待补充"}），解决后经「复测确认」节点收尾，复测不通过回到排查起点（回流）；` +
    `超出处理权限或超时未解决走升级路径（${escPart || "升级路径待补充"}）。首节点标注故障现象，整体为决策树形态`
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const troubleshootingScenario: ScenarioConfig = {
  id: "troubleshooting",
  name: "故障排查 SOP 图",
  tagline: "把排查笔记变成可执行的决策树 SOP",
  emoji: "🛠️",
  maxLength: 500,
  placeholder:
    "按段落粘贴（可选标签：现象/排查/根因/解决/升级），例如：\n现象：用户反馈图片上传失败\n排查：\n检查网络连通性\n查看 OSS 桶配额\n查看上传服务日志\n根因：桶配额已满\n解决：扩容并清理过期文件\n升级：半小时未恢复通知值班经理",
  examples: [
    {
      label: "示例：接口超时排查",
      text: "现象：下单接口偶发超时\n排查：\n查看网关 5xx 比例\n检查数据库慢查询\n查看服务实例 CPU\n根因：慢查询拖满连接池\n解决：加索引并限流\n升级：影响面大于 1% 拉群升级",
    },
  ],
  buildPrompt: (text) => buildSopPrompt(parseSop(text)),
  channel: "scenario:troubleshooting",
};
