/*
 * @Description: FlowDraft → Mermaid flowchart 导出（Round D · R3 档二「Mermaid 代码导出」）
 * 战略价值：语图接入 diagram-as-code 生态的第一步 —— 生成的 Mermaid 可直接粘进
 *   GitHub README / Notion / 语雀（原生渲染），头部注释带来源署名，导出物即传播物。
 * 实现要点：
 *   - 输入为 x6ToFlowDraft 的产物（nodes: {id,label,type} / edges: {id,source,target,label?}），
 *     与 AI 生成/画布手绘两条链路的数据契约一致；
 *   - 六种语义节点 → Mermaid 形状映射（start/end 圆角胶囊、process 矩形、decision 菱形、
 *     io 平行四边形、subprocess 子程序框）；标签统一走引号形式以容纳中文与特殊字符；
 *   - 防御性清洗：id 归一为 Mermaid 合法字符集、标签内引号/竖线/换行转义、
 *     端点不存在的边丢弃（与 flowDraftToX6 的 droppedEdges 语义一致）。
 */

/** 与 x6ToFlowDraft 输出同构的最小契约（避免与转换层类型耦合，导出器独立可测） */
export interface MermaidNode {
  id: string;
  label: string;
  type: string;
}

export interface MermaidEdge {
  id?: string;
  source: string;
  target: string;
  label?: string;
}

export interface MermaidFlowDraft {
  nodes: MermaidNode[];
  edges: MermaidEdge[];
}

/** 导出选项 */
export interface ToMermaidOptions {
  /** 布局方向：TD 自上而下（默认，流程图惯例）/ LR 自左向右 */
  direction?: 'TD' | 'LR';
  /** 头部来源署名注释（缺省自动带品牌句 + 当前站点地址） */
  headerComment?: string;
}

/** 节点类型 → Mermaid 形状包裹器（左右片断；标签统一用引号形式以容纳中文与特殊字符） */
const SHAPE_TABLE: Record<string, [string, string]> = {
  start: ['(["', '"])'],
  end: ['(["', '"])'],
  process: ['["', '"]'],
  decision: ['{"', '"}'],
  io: ['[/"', '"/]'],
  // subprocess 用单引号拼接，避免嵌套双方括号在编辑器里被误读为语法错误
  subprocess: ['[' + '["', '"]' + ']'],
};

/** id 归一：Mermaid 合法字符集外的字符替换为下划线，空 id 按序号兜底 */
function normalizeId(raw: string, index: number): string {
  const cleaned = String(raw ?? '').replace(/[^A-Za-z0-9_-]/g, '_');
  return cleaned || `n${index}`;
}

/** 标签清洗：双引号转单引号（Mermaid 引号串内 #quot; 兼容性差）、换行折叠为空格、去首尾空白 */
function sanitizeLabel(raw: string | undefined): string {
  return String(raw ?? '')
    .replace(/["]/g, "'")
    .replace(/\r?\n/g, ' ')
    .trim();
}

/** 边标签额外清洗：竖线是 Mermaid 边标签语法符，直接剔除 */
function sanitizeEdgeLabel(raw: string | undefined): string {
  return sanitizeLabel(raw).replace(/\|/g, '/');
}

/**
 * FlowDraft → Mermaid flowchart 文本。
 * 永远返回可解析的合法语法：空图输出仅含头部注释与 flowchart 声明。
 */
export function flowDraftToMermaid(draft: MermaidFlowDraft, options: ToMermaidOptions = {}): string {
  const direction = options.direction === 'LR' ? 'LR' : 'TD';
  const header =
    options.headerComment ??
    `语图 Yutu 生成${typeof window !== 'undefined' && window.location.origin ? ` · ${window.location.origin}` : ''}`;

  const nodes = Array.isArray(draft?.nodes) ? draft.nodes : [];
  const edges = Array.isArray(draft?.edges) ? draft.edges : [];

  // 1) 节点行：id 归一 + 唯一性去重（同 id 后者覆盖前者位置不影响语义，保留首个）
  const idMap = new Map<string, string>();
  const nodeLines: string[] = [];
  const seenIds = new Set<string>();
  nodes.forEach((node, index) => {
    const mermaidId = normalizeId(node.id, index);
    const uniqueId = seenIds.has(mermaidId) ? `${mermaidId}_${index}` : mermaidId;
    seenIds.add(uniqueId);
    idMap.set(String(node.id), uniqueId);
    const label = sanitizeLabel(node.label) || ' ';
    const wrapper = SHAPE_TABLE[node.type] ?? SHAPE_TABLE.process;
    nodeLines.push(`    ${uniqueId}${wrapper[0]}${label}${wrapper[1]}`);
  });

  // 2) 边行：端点不存在的边丢弃（与 flowDraftToX6 的 droppedEdges 同语义，不输出悬空引用）
  const edgeLines: string[] = [];
  for (const edge of edges) {
    const source = idMap.get(String(edge.source));
    const target = idMap.get(String(edge.target));
    if (!source || !target) continue;
    const label = sanitizeEdgeLabel(edge.label);
    edgeLines.push(label ? `    ${source} -->|${label}| ${target}` : `    ${source} --> ${target}`);
  }

  // 3) 组装（4 空格缩进，%% 为 Mermaid 注释语法）
  return [`%% ${header}`, `flowchart ${direction}`, ...nodeLines, ...edgeLines].join('\n') + '\n';
}
