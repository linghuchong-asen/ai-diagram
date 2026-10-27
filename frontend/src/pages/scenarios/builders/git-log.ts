/*
 * @Description: Git log → 贡献流程图 builder（Round O）
 * 市场需求：dev 复盘/教学/述职需要把提交历史讲成故事 —— 「这段代码怎么长出来的」
 *   用一张按提交主题分组的流程图呈现，比 log 列表直观得多（配合 /annual 代码年报形成 dev 场景组）。
 * 输入约定：`git log --oneline` 输出（每行 hash + 主题）；也接受 `git log --pretty` 带作者/日期的行。
 * 实现：识别行首 7-40 位 hex 为提交行 → 主题分类统计（feat/fix/refactor/docs… Conventional Commits
 *   + 中文关键词兜底）→ 贡献脉络图指令（按阶段分组：新功能 → 修复 → 优化 → 收尾）。
 */

import type { ScenarioConfig } from "../registry";

/** 提交主题分类规则（顺序优先） */
const COMMIT_KINDS: Array<{ re: RegExp; label: string }> = [
  { re: /^(feat|新增|实现|添加|支持)/i, label: "新功能" },
  { re: /^(fix|修复|解决|bugfix)/i, label: "缺陷修复" },
  { re: /^(refactor|重构|优化|调整)/i, label: "重构优化" },
  { re: /^(docs|文档|注释|readme)/i, label: "文档" },
  { re: /^(test|测试|用例)/i, label: "测试" },
  { re: /^(chore|构建|依赖|ci|部署)/i, label: "工程维护" },
];

/** 解析结果 */
export interface GitLogParseResult {
  /** 提交总数 */
  total: number;
  /** 各分类计数（按 COMMIT_KINDS 顺序，未命中归「其他」） */
  kindCounts: Array<{ label: string; count: number }>;
  /** 按分类归组后的主题样本（每类至多 3 条，去 hash） */
  samples: Array<{ label: string; messages: string[] }>;
  /** 作者计数（--pretty 带作者时可用；oneline 格式为空） */
  authors: Array<{ name: string; count: number }>;
}

/** 行首 hash 识别：7-40 位十六进制 */
const COMMIT_LINE_RE = /^[0-9a-f]{7,40}\s+(.*)$/i;

/** 从行中提取作者（--pretty=format:"%h %an %s" 形态：hash 后第二个词组；宽松：取括号或已知格式） */
function extractAuthor(line: string): string | null {
  const m = line.match(/^[0-9a-f]{7,40}\s+([^\s]+)\s+[0-9a-f]{7,40}\s+(.*)$/i);
  return m ? m[1] : null;
}

/** 单条主题归类的标签 */
function classifyMessage(message: string): string {
  const normalized = message.trim().replace(/^\((\w+)\)\s*/i, ""); // 去作用域前缀 (scope)
  for (const kind of COMMIT_KINDS) {
    if (kind.re.test(normalized)) return kind.label;
  }
  return "其他";
}

/** 解析 git log 文本（纯函数） */
export function parseGitLog(raw: string): GitLogParseResult {
  const kindCounter = new Map<string, number>();
  const sampleMap = new Map<string, string[]>();
  const authorCounter = new Map<string, number>();
  let total = 0;

  for (const rawLine of String(raw ?? "").split(/\r?\n/)) {
    const line = rawLine.trim();
    const commitMatch = line.match(COMMIT_LINE_RE);
    if (!commitMatch) continue;
    const message = commitMatch[1].trim();
    if (!message) continue;
    total += 1;

    const author = extractAuthor(line);
    if (author && !/^[0-9a-f]+$/i.test(author)) {
      authorCounter.set(author, (authorCounter.get(author) ?? 0) + 1);
    }

    const label = classifyMessage(message);
    kindCounter.set(label, (kindCounter.get(label) ?? 0) + 1);
    const samples = sampleMap.get(label) ?? [];
    if (samples.length < 3) samples.push(message.slice(0, 30));
    sampleMap.set(label, samples);
  }

  return {
    total,
    kindCounts: COMMIT_KINDS.map((kind) => ({
      label: kind.label,
      count: kindCounter.get(kind.label) ?? 0,
    })).concat([{ label: "其他", count: kindCounter.get("其他") ?? 0 }]),
    samples: [...sampleMap.entries()].map(([label, messages]) => ({ label, messages })),
    authors: [...authorCounter.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 3),
  };
}

/** 解析结果 → 贡献脉络图生成指令 */
export function buildGitLogPrompt(result: GitLogParseResult): string {
  if (result.total === 0) {
    return "画一张代码贡献流程图：暂未解析到提交记录，请按「新功能开发 → 缺陷修复 → 重构优化 → 文档补全 → 发布收尾」的标准阶段画一张贡献脉络模板图";
  }
  const present = result.kindCounts.filter((kind) => kind.count > 0);
  const stageLines = present
    .map((kind) => {
      const sample = result.samples.find((s) => s.label === kind.label)?.messages ?? [];
      const sampleText = sample.length > 0 ? `（如：${sample.join("；")}）` : "";
      return `${kind.label}×${kind.count}${sampleText}`;
    })
    .join("；");
  const authorPart =
    result.authors.length > 0
      ? `主要贡献者：${result.authors.map((a) => `${a.name}(${a.count} 次)`).join("、")}，按贡献者分泳道`
      : "";
  return (
    `画一张代码贡献脉络流程图，共 ${result.total} 次提交，按阶段分组：${stageLines}。` +
    "阶段之间用带箭头的时序连线（从早期到近期），每组内列出代表性提交主题作为节点；" +
    `缺陷修复组与重构优化组之间画双向「发现-修复」回流线。${authorPart}。末端加「下个迭代计划」展望节点`
  );
}

/** 场景配置（注册到 SCENARIOS） */
export const gitLogScenario: ScenarioConfig = {
  id: "git-log",
  name: "Git 提交转贡献图",
  tagline: "粘贴 git log，生成本迭代贡献脉络图",
  emoji: "🐙",
  maxLength: 500,
  placeholder:
    "粘贴 git log --oneline 输出，例如：\na1b2c3d feat: 新增购物车模块\ne4f5a6b fix: 修复支付回调偶发失败\n5d6e7f8 refactor: 抽离通用请求层",
  examples: [
    {
      label: "示例：一个迭代的 log",
      text: "a1b2c3d feat: 新增购物车模块\ne4f5a6b feat: 购物车支持优惠券\n1a2b3c4 fix: 修复支付回调偶发失败\n5d6e7f8 fix: 修复库存扣减超卖\n9a8b7c6 refactor: 抽离通用请求层\n3f2e1d0 docs: 补充部署文档",
    },
  ],
  buildPrompt: (text) => buildGitLogPrompt(parseGitLog(text)),
  channel: "scenario:git-log",
};
