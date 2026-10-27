/*
 * @Description: 审批流表单生成器 builder（Round N）
 * 市场需求：行政/HR 的审批流设计是高频刚需（请假/报销/采购……）——现有产品只有静态模板，
 *   「角色链 + 条件加签」的自定义审批流只能靠专业 BPM 工具，本场景让一句话级别的输入即可成图。
 * 输入约定（宽松两行式）：
 *   「链：员工→主管→HR」（角色链用 → 串联）
 *   「条件：金额>5000 加签 总监」/「超过 3 天 需 经理复核」（条件行逐条列出）
 *   可选「抄送：财务」（末端抄送节点）
 */

import type { ScenarioConfig } from "../registry";

/** 审批流解析结果 */
export interface ApprovalParseResult {
  /** 角色链（顺序） */
  chain: string[];
  /** 条件规则：{ trigger 描述, action 描述 } */
  conditions: Array<{ trigger: string; action: string }>;
  /** 抄送角色 */
  cc: string[];
}

/** 提取「链：」行的角色序列 */
function parseChain(line: string): string[] {
  return line
    .split("→")
    .map((role) => role.trim())
    .filter(Boolean);
}

/** 解析审批流输入（纯函数） */
export function parseApproval(raw: string): ApprovalParseResult {
  const result: ApprovalParseResult = { chain: [], conditions: [], cc: [] };

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue;

    const chainMatch = line.match(/^(?:链|审批链|角色链|流程)\s*[：:]\s*(.+)$/);
    if (chainMatch) {
      result.chain.push(...parseChain(chainMatch[1]));
      continue;
    }
    const ccMatch = line.match(/^(?:抄送|知会)\s*[：:]\s*(.+)$/);
    if (ccMatch) {
      result.cc.push(...ccMatch[1].split(/[、,，\s]+/).filter(Boolean));
      continue;
    }
    const condMatch = line.match(/^(?:条件|规则)\s*[：:]\s*(.+)$/);
    const condBody = condMatch ? condMatch[1] : line;
    // 条件行按「加签/需/则/转」切出动作
    const actionSplit = condBody.match(/^(.*?)(?:加签|需|则|转)(.+)$/);
    if (actionSplit) {
      result.conditions.push({
        trigger: actionSplit[1].trim(),
        action: actionSplit[2].trim(),
      });
    } else if (condMatch) {
      // 有「条件：」前缀但没切出动作 → 整句作为 trigger
      result.conditions.push({ trigger: condBody.trim(), action: "按规则处理" });
    } else {
      // 无任何标记的行：含 → 视为补充链段，否则视为条件描述
      if (line.includes("→")) {
        result.chain.push(...parseChain(line));
      } else {
        result.conditions.push({ trigger: line, action: "按规则处理" });
      }
    }
  }
  return result;
}

/** 解析结果 → 审批流泳道图生成指令 */
export function buildApprovalPrompt(result: ApprovalParseResult): string {
  const chainPart =
    result.chain.length > 0
      ? `审批链：${result.chain.join(" → ")}`
      : "审批链：申请人 → 直属主管 → 备案归档（默认三步，可修改）";
  const condPart =
    result.conditions.length > 0
      ? `条件规则：${result.conditions.map((cond) => `当${cond.trigger}时，${cond.action}`).join("；")}`
      : "";
  const ccPart = result.cc.length > 0 ? `流程结束后抄送：${result.cc.join("、")}` : "";
  return (
    `画一张审批流程图（泳道式）。${chainPart}。` +
    `每个审批角色占一条横向泳道，节点为该角色的审批动作；每个审批节点带「通过/驳回」两个出口，` +
    `驳回回到申请人节点（回流）。${condPart}${
      condPart ? "，条件命中时在对应节点后插入加签/复核分支" : ""
    }。${ccPart}。末端以「归档」结束节点收尾`
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const approvalScenario: ScenarioConfig = {
  id: "approval",
  name: "审批流生成器",
  tagline: "角色链加条件规则，一句话生成审批泳道图",
  emoji: "✅",
  maxLength: 500,
  placeholder:
    "示例（两行式）：\n链：员工 → 主管 → 人事\n条件：超过 3 天 需 经理复核\n抄送：财务",
  examples: [
    {
      label: "示例：报销审批",
      text: "链：员工 → 主管 → 财务\n条件：金额大于 5000 加签 总监\n条件：票据缺失 需 退回补充\n抄送：财务归档",
    },
  ],
  buildPrompt: (text) => buildApprovalPrompt(parseApproval(text)),
  channel: "scenario:approval",
};
