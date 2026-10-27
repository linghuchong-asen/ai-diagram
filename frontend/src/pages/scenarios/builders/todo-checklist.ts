/*
 * @Description: 待办清单 builder（competitor-driven-evolution-batch Round 17）
 * 场景：会议纪要转待办 / 上线检查单 / 出发行李清单 —— 怕遗漏的可勾选集合是清单形态的本命
 *   （竞品调研 G9：boardmix/ProcessOn 均有 checklist 模板;语图补上多形态版）。
 * 输入约定：每行一项;「组名：」或「组名:」结尾的行开新分组;无分组标记的行进「待办」默认组。
 * 产物形态：checklist（场景页拼 &form=checklist 直达）。
 */

import type { ScenarioConfig } from "../registry";

/** 清单输入解析结果：分组 + 未分组散项 */
export interface ChecklistParseResult {
  groups: Array<{ title: string; items: string[] }>;
  totalItems: number;
}

/** 分组行标记：行以「XX：」或「XX:」结尾成组（中文冒号/英文冒号均可,组名 ≤12 字） */
const GROUP_RE = /^([^：:]{1,12})[：:]\s*$/;

/** 解析清单输入（纯函数）：分组行开组,其余行归当前组（初始「待办」） */
export function parseChecklistInput(raw: string): ChecklistParseResult {
  const groups: Array<{ title: string; items: string[] }> = [];
  let current = -1;
  let totalItems = 0;

  const ensureGroup = (title: string) => {
    current = groups.findIndex((group) => group.title === title);
    if (current === -1) {
      groups.push({ title, items: [] });
      current = groups.length - 1;
    }
  };
  ensureGroup("待办");

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || /^[-—_=*·]+$/.test(line)) continue;
    const groupMatch = line.match(GROUP_RE);
    if (groupMatch) {
      ensureGroup(groupMatch[1].trim());
      continue;
    }
    groups[current].items.push(line);
    totalItems += 1;
  }

  // 清理空默认组（存在其他组时;全空输入保留兜底组）
  const pruned =
    groups.length > 1 && groups[0].title === "待办" && groups[0].items.length === 0
      ? groups.slice(1)
      : groups;
  return { groups: pruned, totalItems };
}

/** 解析结果 → 清单生成指令（按组罗列,保留用户的原始分组语义） */
export function buildChecklistPrompt(result: ChecklistParseResult): string {
  if (result.totalItems === 0) {
    return "帮我生成一份通用待办清单：按「准备 / 执行 / 收尾」分组,每项可勾选可验收";
  }
  const groupLines = result.groups
    .map((group) => `${group.title}：${group.items.join("、")}`)
    .join("；");
  return `把以下事项整理成分组待办清单：${groupLines}。保留我的分组,每项写成可勾选、可验收的具体动作,可推断责任人或时间时补充标注`;
}

/** 场景配置（注册到 SCENARIOS） */
export const todoChecklistScenario: ScenarioConfig = {
  id: "checklist",
  name: "待办清单",
  tagline: "把会议纪要、散乱事项变成分组可勾选清单",
  emoji: "✅",
  maxLength: 500,
  placeholder:
    "每行一项;单独一行「组名：」开新分组。例如：\n上线前：\n回归测试全量通过\n数据库备份\n上线后：\n监控观察 30 分钟",
  examples: [
    {
      label: "示例：上线检查单",
      text: "上线前：\n回归测试全量通过\n数据库备份完成\n回滚预案就绪\n上线后：\n监控观察 30 分钟\n群公告发布",
    },
    {
      label: "示例：出行准备",
      text: "证件：\n身份证\n护照\n电子设备：\n充电宝\n转换插头",
    },
  ],
  buildPrompt: (text) => buildChecklistPrompt(parseChecklistInput(text)),
  channel: "scenario:checklist",
  formHint: "checklist",
};
