// 语图技术方案 - Mermaid 流程图 DSL 导入解析器（competitor-driven-evolution-batch Round 2/3）
// 背景：Mermaid 是文本图表事实标准（GitHub/GitLab/Notion/Obsidian 原生渲染，~70k★）。
//       竞品（Excalidraw text-to-diagram / draw.io / Mermaid Chart）都把「粘贴 DSL 变图」作为标配入口，
//       接入导入 = 免费承接用户存量 Mermaid 资产（G1 差距）。
// 设计原则（与 transform/to-x6.ts 同源哲学）：
//   ① 纯函数、不抛异常——脏语法一律降级为 warning 明细，绝不白屏；
//   ② 输出语图语义 FlowDraft（id/label/type + 边），坐标由既有 autoLayout 程序化生成；
//   ③ 解析不了的部分如实记录（warnings），不静默吞掉。
// 支持范围（Round 2）：graph/flowchart 声明、TD/TB/LR 方向、九种节点形状、五种箭头（含带文字变体）、
//           |标签| 与 -- 文字 -- 两种边标签、链式 A-->B-->C、裸节点引用。
// 支持范围（Round 3 追加）：subgraph 分组（含嵌套；组内裸节点→subprocess，分组框不保留并记 warning）、
//           样式/交互指令行容忍跳过（style/classDef/class/linkStyle/click/init/direction/config）、
//           & 并联边展开（A --> B & C 出两条边）、end 关键字收组。

/** 语图语义节点类型（与 transform/types 对齐；此处独立声明避免运行时依赖） */
export interface MermaidNode {
  id: string;
  label: string;
  type: 'start' | 'end' | 'process' | 'decision' | 'io' | 'subprocess';
}

export interface MermaidEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface MermaidFlowDraft {
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

export interface MermaidParseResult {
  /** false = 不是 mermaid flowchart 或完全解析不出内容 */
  ok: boolean;
  draft?: MermaidFlowDraft;
  /** 降级/容忍明细（导入 UI 可回显） */
  warnings: string[];
}

/**
 * 边的连接符模式（按最长优先排列,一次 split 处理一行多段链式连接）：
 *   -\.…->  虚线箭头（可带文字：-. 文字 .->）
 *   ==…==>  粗箭头（可带文字）
 *   --…-->  普通箭头（可带文字：-- 文字 -->）
 *   ==> --> -> ---  无文字变体（--- 为无箭头连线,导入后按普通边处理）
 * 捕获组保留匹配原文,供提取内联文字标签。
 */
const ARROW_RE = /(-\.[^>]*?->|==[^=>]*?==>|--[^->]*?-->|==+>|--+>|->|-{3,})/g;

/** 从箭头原文中提取内联文字标签（`-- 是 -->` → `是`；无文字返回 undefined） */
function inlineArrowLabel(arrow: string): string | undefined {
  const text = arrow.replace(/^[->.=\s]+|[->.=\s]+$/g, '').trim();
  return text ? text : undefined;
}

/** 去除节点/标签文本两侧的成对引号 */
function unquote(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= 2 && ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

/** 节点 id 的合法字符（字母/数字/下划线/连字符/中文——覆盖 mermaid 常见 id 与中文 id） */
const NODE_ID_RE = /[A-Za-z0-9_\u4e00-\u9fa5-]+/;

/** 形状表：正则按「界定符最长」优先匹配,映射到语图语义类型 */
const SHAPE_RULES: Array<{ re: RegExp; type: MermaidNode['type'] }> = [
  // ((text)) 圆形 → start（终态判定在解析后按出度修正为 end）
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\(\((.+)\)\)$/, type: 'start' },
  // ([text]) 体育场形 → start（同上,按出度修正）
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\(\[(.+)\]\)$/, type: 'start' },
  // [[text]] 子程序 → subprocess
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\[\[(.+)\]\]$/, type: 'subprocess' },
  // [(text)] 圆柱(数据库) → io
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\[\((.+)\)\]$/, type: 'io' },
  // {{text}} 六边形 → process
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\{\{(.+)\}\}$/, type: 'process' },
  // {text} 菱形 → decision
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\{(.+)\}$/, type: 'decision' },
  // [/text/] 与 [\text\] 平行四边形(输入输出) → io（注意界定符是 [/ 与 /] 整体）
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\[\/(.+)\/\]$/, type: 'io' },
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\[\\(.+)\\\]$/, type: 'io' },
  // >text] 旗形 → io
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*>(.+)\]$/, type: 'io' },
  // (text) 圆角矩形 → process
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\((.+)\)$/, type: 'process' },
  // [text] 矩形 → process
  { re: /^([A-Za-z0-9_\u4e00-\u9fa5-]+)\s*\[(.+)\]$/, type: 'process' },
];

/**
 * 解析单个节点片段:带形状定义 / 裸 id 引用（label=id,type=process）。
 * @param strict true(独立行场景):裸引用必须是纯 id,带杂质的行视为垃圾返回 null——
 *               否则「!!! 说明文字 !!!」这类脏行会被错误吸收为节点;
 *               false(边端点场景):端点带杂质时截取首个 id 段容错(边语义更重要,不轻易丢)。
 */
function parseNodeToken(token: string, strict = false): { node: MermaidNode; defined: boolean } | null {
  const text = token.trim();
  if (!text) return null;
  for (const rule of SHAPE_RULES) {
    const match = text.match(rule.re);
    if (match) {
      return { node: { id: match[1]!, label: unquote(match[2]!), type: rule.type }, defined: true };
    }
  }
  // 裸引用:A 或 a1（无形状语法）——已定义则沿用,未定义按 process 兜底
  const bare = text.match(NODE_ID_RE);
  if (bare && bare[0] === text) {
    return { node: { id: text, label: text, type: 'process' }, defined: false };
  }
  // 带特殊字符的裸文本:仅边端点容错(截取首个合法 id 段)
  if (!strict && bare) {
    return { node: { id: bare[0], label: text, type: 'process' }, defined: false };
  }
  return null;
}

/**
 * 解析 mermaid flowchart/graph 源码 → 语图 FlowDraft。
 * 不是 flowchart 语法（如 sequenceDiagram/classDiagram）时返回 ok=false,由上层提示换方言。
 */
/** 样式/交互/配置指令行:不影响图结构,导入时容忍跳过（Round 3） */
const DIRECTIVE_RE = /^(style|classDef|class|linkStyle|click|init|direction|config|logLevel|accentRenderer)\b/i;

export function parseMermaidFlowchart(source: string): MermaidParseResult {
  const warnings: string[] = [];
  const nodesById = new Map<string, MermaidNode>();
  const edges: MermaidEdge[] = [];
  let edgeCounter = 0;
  /** subgraph 嵌套深度（Round 3）:组内裸节点按 subprocess 语义,分组框本身不保留 */
  let subgraphDepth = 0;
  let subgraphCount = 0;

  const lines = String(source ?? '')
    .split('\n')
    // %% 注释行整行剔除
    .map((line) => line.replace(/%%.*$/, '').trim())
    .filter(Boolean);

  // 头行必须是 graph/flowchart 声明（可带方向 TD/TB/LR/RL/BT）
  const header = lines[0]?.match(/^(?:graph|flowchart)\s*(?:TD|TB|LR|RL|BT)?\s*$/i);
  if (!header) {
    return { ok: false, warnings: ['首行不是 graph/flowchart 声明（可能是其他 mermaid 图型或非 mermaid 文本）'] };
  }

  const registerNode = (node: MermaidNode, defined: boolean, lineNo: number) => {
    const existing = nodesById.get(node.id);
    if (existing) {
      // 重复定义:首次带形状的定义优先,后到的裸引用不覆盖
      if (defined && existing.label === existing.id) {
        nodesById.set(node.id, node);
      } else if (defined && (existing.label !== node.label || existing.type !== node.type)) {
        warnings.push(`第 ${lineNo} 行:节点 ${node.id} 重复定义,保留首个定义`);
      }
      return;
    }
    nodesById.set(node.id, node);
  };

  const addEdge = (source: string, target: string, label: string | undefined, lineNo: number) => {
    if (source === target) {
      warnings.push(`第 ${lineNo} 行:自环边 ${source}→${target} 已跳过`);
      return;
    }
    edgeCounter += 1;
    edges.push({ id: `me${edgeCounter}`, source, target, label });
  };

  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineNo = i + 1;

    // ---- Round 3:subgraph 开组 / end 收组 / 指令行跳过 ----
    if (/^subgraph\b/i.test(line)) {
      subgraphDepth += 1;
      subgraphCount += 1;
      continue;
    }
    // end 收组:仅在组内生效（避免把叫 end 的裸节点误吞）
    if (/^end\b/i.test(line) && subgraphDepth > 0) {
      subgraphDepth -= 1;
      continue;
    }
    if (DIRECTIVE_RE.test(line)) {
      continue; // 样式/交互行:不影响结构
    }

    // split 保留分隔符:parts = [节点, 箭头, 节点, ...]
    const parts = line.split(ARROW_RE).filter((p) => p !== undefined && p !== '');
    if (parts.length === 1) {
      // 单独一行:要么是纯节点定义,要么是不认识的指令。
      // strict 模式:带杂质的行直接判垃圾(避免说明文字被吸收为节点)
      const parsed = parseNodeToken(parts[0]!, true);
      if (parsed) {
        registerNode(parsed.node, parsed.defined, lineNo);
      } else {
        warnings.push(`第 ${lineNo} 行:无法识别,已跳过（${parts[0]!.slice(0, 20)}）`);
      }
      continue;
    }

    // 含至少一个箭头:链式解析 A -->|是| B & C --> D（frontier = 链上当前位置的节点 id 集合）
    let pendingLabel: string | undefined;
    /** 链上上一个位置的节点 id 集合（支持 & 并联展开后的一对多/多对一） */
    let frontier: string[] = [];
    for (let j = 0; j < parts.length; j += 1) {
      const part = parts[j]!;
      if (j % 2 === 1) {
        // 箭头段:提取内联文字标签（-- 是 --> 形态）
        const inline = inlineArrowLabel(part);
        if (inline) pendingLabel = inline;
        continue;
      }
      let tokenText = part;
      // |标签| 形态贴在右侧节点前:A -->|是| B → 先摘掉标签
      const pipe = tokenText.match(/^\s*\|([^|]*)\|\s*([\s\S]*)$/);
      if (pipe) {
        pendingLabel = unquote(pipe[1]!) || pendingLabel;
        tokenText = pipe[2]!;
      }
      // & 并联展开:A --> B & C（同侧多个端点,笛卡尔建边）
      const tokens = tokenText.split('&').map((t) => t.trim()).filter(Boolean);
      const ids: string[] = [];
      for (const token of tokens) {
        const parsed = parseNodeToken(token);
        if (!parsed) {
          if (token.trim()) warnings.push(`第 ${lineNo} 行:节点片段无法识别,已跳过（${token.trim().slice(0, 20)}）`);
          continue;
        }
        // 组内裸节点 → subprocess 语义（subgraph 分组框不保留,以类型语义承接;带形状节点保持原类型）
        if (subgraphDepth > 0 && !parsed.defined) {
          parsed.node.type = 'subprocess';
        }
        registerNode(parsed.node, parsed.defined, lineNo);
        ids.push(parsed.node.id);
      }
      // frontier → 当前位置所有 id 建边（标签只挂在紧邻的第一段边上——mermaid 语义中标签属于该箭头）
      for (const source of frontier) {
        for (const target of ids) {
          addEdge(source, target, pendingLabel, lineNo);
        }
      }
      if (ids.length > 0) {
        frontier = ids;
        pendingLabel = undefined;
      }
    }
  }

  if (nodesById.size === 0) {
    return { ok: false, warnings: [...warnings, '未解析到任何节点'] };
  }
  // 有 subgraph 但未闭合:end 缺失,如实提示（不影响已解析结果）
  if (subgraphDepth > 0) {
    warnings.push(`subgraph 未全部闭合(剩余嵌套深度 ${subgraphDepth}),结果可能不完整`);
  }
  if (subgraphCount > 0) {
    warnings.push(`检测到 ${subgraphCount} 个 subgraph 分组:分组框不保留(组内裸节点已按 subprocess 导入)`);
  }

  // 终态修正:圆形/体育场形节点若无出边,语义上是「结束」而非「开始」
  const outDegree = new Map<string, number>();
  for (const edge of edges) outDegree.set(edge.source, (outDegree.get(edge.source) ?? 0) + 1);
  for (const node of nodesById.values()) {
    if (node.type === 'start' && (outDegree.get(node.id) ?? 0) === 0) {
      node.type = 'end';
    }
  }

  return {
    ok: true,
    draft: { nodes: [...nodesById.values()], edges },
    warnings,
  };
}
