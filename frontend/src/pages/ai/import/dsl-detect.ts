// 语图技术方案 - DSL 方言识别（competitor-driven-evolution-batch Round 5）
// 定位：「粘贴 DSL 导入」入口的前置判断——用户粘贴的可能是 Mermaid 或 PlantUML,
//       也可能是普通文字。识别结果决定走哪个解析器;识别不了则提示不支持。
// 原则:纯函数、宽松匹配(用户粘贴常带前后空行/```mermaid 代码块围栏)。
import type { MermaidParseResult } from './mermaid-parser';
import { parseMermaidFlowchart } from './mermaid-parser';
import { parsePlantumlActivity } from './plantuml-parser';

/** 支持导入的方言 */
export type DslDialect = 'mermaid' | 'plantuml';

export interface DslDetectResult {
  dialect: DslDialect | null;
  /** 剥离代码块围栏后的干净源码(可直接喂解析器) */
  source: string;
  /** 识别依据(可观测/提示用) */
  reason: string;
}

/**
 * 识别 DSL 方言:
 *   - ```mermaid / ```plantuml 代码块围栏 → 对应方言,围栏剥离
 *   - @startuml 头 → plantuml
 *   - 首个非空行是 graph/flowchart 声明 → mermaid
 *   - 其余 → null(不是支持的 DSL)
 */
export function detectDsl(raw: string): DslDetectResult {
  let text = String(raw ?? '').trim();

  // 代码块围栏:```mermaid ... ``` / ```plantuml ... ``` / ```plantuml? 通用 ```
  const fenced = text.match(/^```([A-Za-z]*)\s*\n([\s\S]*?)\n?```$/);
  if (fenced) {
    const lang = fenced[1]!.toLowerCase();
    text = fenced[2]!.trim();
    if (lang === 'mermaid') return { dialect: 'mermaid', source: text, reason: '```mermaid 代码块围栏' };
    if (lang === 'plantuml' || lang === 'puml') return { dialect: 'plantuml', source: text, reason: '```plantuml 代码块围栏' };
    // 无语言围栏:按内容继续判断
  }

  // @startuml 头(可带图名)
  if (/^@startuml\b/i.test(text)) {
    return { dialect: 'plantuml', source: text, reason: '@startuml 声明' };
  }
  // 首个非空行为 graph/flowchart 声明
  const firstLine = text.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  if (/^(graph|flowchart)\s+(TD|TB|LR|RL|BT)\b/i.test(firstLine) || /^(graph|flowchart)\s*$/i.test(firstLine)) {
    return { dialect: 'mermaid', source: text, reason: `${firstLine.split(/\s+/)[0]} 声明` };
  }
  return { dialect: null, source: text, reason: '未匹配到已支持的 DSL 特征(支持 Mermaid flowchart 与 PlantUML activity)' };
}

/** 统一导入入口:识别方言 → 解析 → MermaidFlowDraft(两个解析器输出同构) */
export function importDsl(raw: string): { dialect: DslDialect | null; parse: MermaidParseResult } {
  const detected = detectDsl(raw);
  if (!detected.dialect) {
    return {
      dialect: null,
      parse: { ok: false, warnings: [detected.reason] } as MermaidParseResult,
    };
  }
  if (detected.dialect === 'mermaid') {
    return { dialect: 'mermaid', parse: parseMermaidFlowchart(detected.source) };
  }
  return { dialect: 'plantuml', parse: parsePlantumlActivity(detected.source) };
}
