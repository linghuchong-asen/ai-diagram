/*
 * @Description: JD → 面试准备图 builder（Round L）
 * 市场需求：秋招/春招求职刚需 —— 拿到 JD 后准备面试是高频动作，
 *   「按 JD 倒推面试准备清单」是求职辅导的标准方法论，做成一张图可随身执行。
 * 输入：粘贴职位描述（JD）原文。
 * 实现：轻量关键词抽取（技术栈/软技能词典命中 + 职责/要求段落切分）→
 *   结构化「面试准备流程图」指令（自我介绍 → 技能盘点 → 项目对齐 → 反问环节）。
 */

import type { ScenarioConfig } from "../registry";

/** 技术栈/能力词典（命中即视为 JD 考点；按需扩充） */
const SKILL_DICTIONARY: string[] = [
  "Java", "Python", "Go", "TypeScript", "JavaScript", "React", "Vue", "Node",
  "Spring", "MySQL", "PostgreSQL", "Redis", "Kafka", "RabbitMQ", "Elasticsearch",
  "Docker", "Kubernetes", "K8s", "CI/CD", "Linux", "微服务", "分布式", "高并发",
  "算法", "数据结构", "机器学习", "深度学习", "大模型", "LLM", "SQL", "Figma",
  "产品设计", "数据分析", "用户增长", "运营", "文案", "剪辑",
];

/** 软技能词典 */
const SOFT_SKILL_DICTIONARY: string[] = [
  "沟通", "协作", "抗压", "学习能力", "责任心", "主动性", "跨部门", "领导力",
];

/** JD 解析结果 */
export interface JdParseResult {
  /** 命中的技术/专业能力词（去重，按词典序） */
  skills: string[];
  /** 命中的软技能词 */
  softSkills: string[];
  /** 「职责/要求」段落切出的条目行（非空、长度 ≥ 6 的行） */
  dutyLines: string[];
  /** 经验要求（「X 年」模式首个命中） */
  experience: string | null;
  /** 学历要求（首个命中） */
  education: string | null;
}

/** 解析 JD 文本（纯函数） */
export function parseJd(raw: string): JdParseResult {
  const text = String(raw ?? "");
  const skills = SKILL_DICTIONARY.filter((skill) =>
    new RegExp(`(^|[^a-zA-Z])${skill.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-zA-Z]|$)`, "i").test(text),
  );
  const softSkills = SOFT_SKILL_DICTIONARY.filter((skill) => text.includes(skill));

  const dutyLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 6 && !/^(公司|薪资|福利|地址|简历)/.test(line))
    .slice(0, 6);

  // 经验提取：「3 年以上 Java 开发经验」「3 年工作经验」「三年以上经验」——
  // 年限与「经验」之间允许出现 ≤10 个非标点字符（技术栈词等），两组数字/汉字年限都认
  const expMatch =
    text.match(/(\d+)\s*年(?:以上)?[^，。;；\n]{0,10}经验/) ??
    text.match(/([一二三四五六七八九十]+)\s*年(?:以上)?[^，。;；\n]{0,10}经验/);
  const eduMatch = text.match(/(本科|硕士|研究生|大专)(?:及以上)?/);

  return {
    skills,
    softSkills,
    dutyLines,
    // 年限归一为「N 年」展示口径
    experience: expMatch ? `${expMatch[1]} 年` : null,
    education: eduMatch ? eduMatch[1] : null,
  };
}

/** 解析结果 → 面试准备流程图生成指令 */
export function buildJdPrompt(result: JdParseResult): string {
  const skillPart =
    result.skills.length > 0
      ? `重点技能考点：${result.skills.join("、")}`
      : "技能考点：按职责描述自行提炼";
  const softPart = result.softSkills.length > 0 ? `；软性考察：${result.softSkills.join("、")}` : "";
  const dutyPart =
    result.dutyLines.length > 0 ? `核心职责：${result.dutyLines.join("；")}` : "";
  const requirementPart = [
    result.experience ? `经验要求 ${result.experience}` : "",
    result.education ? `学历要求 ${result.education}` : "",
  ]
    .filter(Boolean)
    .join("，");
  return (
    `画一张「面试准备作战图」流程图：目标岗位${requirementPart ? `（${requirementPart}）` : ""}。` +
    `${skillPart}${softPart}。${dutyPart}` +
    "流程结构：研读 JD → 技能盘点（逐项自评：熟练/了解/不会，「不会」分支接「面试前突击学习」）→ " +
    "项目复盘（挑 2 个与职责最匹配的项目准备 STAR 叙述）→ 模拟问答（技术题 + 行为题双分支）→ " +
    "准备反问环节（业务方向/团队协作两个反问节点）→ 面试当天检查清单收尾"
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const jdInterviewScenario: ScenarioConfig = {
  id: "jd-interview",
  name: "JD 转面试准备图",
  tagline: "粘贴职位描述，生成按考点倒推的面试作战图",
  emoji: "💼",
  maxLength: 500,
  placeholder:
    "粘贴目标岗位的 JD 原文（职责与任职要求），例如：\n负责电商平台后端开发，3 年以上经验，本科及以上；\n熟悉 Java/Spring/MySQL，了解 Redis 与消息队列；\n良好的沟通与跨部门协作能力。",
  examples: [
    {
      label: "示例：后端工程师 JD",
      text: "岗位职责：负责电商平台后端服务开发与维护，参与系统架构设计。\n任职要求：3 年以上 Java 开发经验，本科及以上学历；熟悉 Spring、MySQL、Redis，了解消息队列与分布式系统；具备良好的沟通能力与团队协作精神。",
    },
  ],
  buildPrompt: (text) => buildJdPrompt(parseJd(text)),
  channel: "scenario:jd-interview",
};
