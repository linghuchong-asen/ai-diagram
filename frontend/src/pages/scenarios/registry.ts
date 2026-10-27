/*
 * @Description: 场景注册表（场景工厂核心）—— 10 轮场景迭代的统一接入点
 * 每个场景 = 一份配置（文案 + 示例 + buildPrompt 纯函数），由通用页 ScenarioPage 渲染。
 * 新增场景零路由改动：注册即可经 /s/:scenarioId 访问；纯函数逻辑收敛在 builders/ 下可测。
 * competitor-driven-evolution-batch Round 17：ScenarioConfig 新增可选 formHint——
 *   多形态场景（对比表/清单/时间线/导图）声明产物形态，提交时拼 /trial?q=...&form= 直达。
 */

import { weeklyReportScenario } from "./builders/weekly-report";
import { sqlDdlScenario } from "./builders/sql-ddl";
import { pseudoCodeScenario } from "./builders/pseudo-code";
import { travelScenario } from "./builders/travel";
import { jdInterviewScenario } from "./builders/jd-interview";
import { troubleshootingScenario } from "./builders/troubleshooting";
import { approvalScenario } from "./builders/approval";
import { gitLogScenario } from "./builders/git-log";
import { okrScenario } from "./builders/okr";
// competitor-driven-evolution-batch Round 17：多形态场景（四新形态各一）
import { comparisonScenario } from "./builders/comparison";
import { todoChecklistScenario } from "./builders/todo-checklist";
import { travelPlanScenario } from "./builders/travel-plan";
import { readingMapScenario } from "./builders/reading-map";

/** 场景配置（通用页消费的完整契约） */
export interface ScenarioConfig {
  id: string;
  name: string;
  /** 一句话场景说明（索引卡片副题） */
  tagline: string;
  /** 卡片 emoji（避免逐场景引入 icon 依赖） */
  emoji: string;
  /** 输入区占位文案 */
  placeholder: string;
  /** 示例填充（点击填入，降低空白页摩擦） */
  examples: Array<{ label: string; text: string }>;
  /** 输入上限（匿名试用链路 500 字内由各场景自行裁剪） */
  maxLength: number;
  /** 原始文本 → 生成指令（纯函数，check 脚本覆盖） */
  buildPrompt: (text: string) => string;
  /** 提交埋点渠道码（事件统一为 scenario_submit） */
  channel: string;
  /**
   * 产物形态提示（Round 17,多形态场景专用）：提交时拼 /trial?form= 透传,
   * FormRouter formHint 直通——场景页「指哪打哪」,不再赌关键词路由。
   * 取值与后端 ArtifactKind 新形态白名单一致（flowchart 是缺省,场景工厂既有场景不填）。
   */
  formHint?: "mindmap" | "table" | "checklist" | "timeline";
}

/** 全部场景（索引页按此顺序渲染；新场景在此追加一行） */
export const SCENARIOS: ScenarioConfig[] = [
  weeklyReportScenario,
  sqlDdlScenario,
  pseudoCodeScenario,
  travelScenario,
  jdInterviewScenario,
  troubleshootingScenario,
  approvalScenario,
  gitLogScenario,
  okrScenario,
  comparisonScenario,
  todoChecklistScenario,
  travelPlanScenario,
  readingMapScenario,
];

/** 按 id 查找场景（路由参数 → 配置；未命中返回 undefined） */
export function findScenario(id: string | undefined): ScenarioConfig | undefined {
  if (!id) return undefined;
  return SCENARIOS.find((scenario) => scenario.id === id);
}
