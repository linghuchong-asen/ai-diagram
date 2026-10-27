// 语图技术方案 - 多形态产物结构校验器(multi-artifact-batch Round 5)
// 定位:反思层「第二层确定性校验」在四新形态上的实现(与 graph.validator 之于 FlowDraft 同构)。
// 分层原则:Zod Schema 管字段级格式(类型/长度/行列对齐),本文件管跨字段结构合理性
// (树深度/节点总数/重复 id/空单元格占比/分组重复等)——这些问题 Zod 表达不了,需要遍历。
// 输出契约:与 graph.validator 一致的 error/warning 两级 ReflectionIssue;
//   error 触发 Rewriter 局部修正循环,warning 仅透出不阻断(如「—」占比偏高)。
import { ArtifactKind, MindMapNode } from '../schemas/artifact.schema';
import { ReflectionIssue } from './evaluator';

/** 非 flowchart 的四种形态(flowchart 的结构校验走既有 GraphValidator,不在此重复) */
export type NewArtifactKind = Exclude<ArtifactKind, 'flowchart'>;

export interface ArtifactValidationResult {
  valid: boolean;
  issues: ReflectionIssue[];
  blockingIssues: ReflectionIssue[];
  warnings: ReflectionIssue[];
}

/** 便捷构造:error 级(阻断,Rewriter 修正目标) */
function error(message: string, type: string, nodeIds?: string[]): ReflectionIssue {
  return { layer: 'structure', severity: 'error', message, type, nodeIds };
}

/** 便捷构造:warning 级(不阻断,随结果透出) */
function warning(message: string, type: string, nodeIds?: string[]): ReflectionIssue {
  return { layer: 'structure', severity: 'warning', message, type, nodeIds };
}

function finalize(issues: ReflectionIssue[]): ArtifactValidationResult {
  const blockingIssues = issues.filter((i) => (i.severity ?? 'error') === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return { valid: blockingIssues.length === 0, issues, blockingIssues, warnings };
}

// ---------------------------------------------------------------------------
// mindmap:树的遍历指标(计数/深度/id 收集/单子链检测)
// ---------------------------------------------------------------------------

/** 树遍历指标(导出供测试与 Rewriter 摘要复用) */
export interface MindMapMetrics {
  total: number;
  maxDepth: number; // 根为第 1 层
  ids: string[];
  /** 恰好只有 1 个子节点的父节点 id 列表(层级冗余,应合并) */
  singleChildParents: string[];
  /** 同一父节点下 label 重复的 id 列表 */
  duplicateSiblingLabelIds: string[];
}

export function measureMindMap(root: MindMapNode): MindMapMetrics {
  const metrics: MindMapMetrics = { total: 0, maxDepth: 0, ids: [], singleChildParents: [], duplicateSiblingLabelIds: [] };
  const walk = (node: MindMapNode, depth: number) => {
    metrics.total += 1;
    metrics.maxDepth = Math.max(metrics.maxDepth, depth);
    metrics.ids.push(node.id);
    if (node.children.length === 1) metrics.singleChildParents.push(node.id);
    // 同父同级 label 重复(兄弟概念应互斥)
    const seen = new Set<string>();
    for (const child of node.children) {
      if (seen.has(child.label)) metrics.duplicateSiblingLabelIds.push(child.id);
      seen.add(child.label);
    }
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(root, 1);
  return metrics;
}

function validateMindmap(root: MindMapNode): ReflectionIssue[] {
  const issues: ReflectionIssue[] = [];
  const m = measureMindMap(root);

  // 根节点必须有分支(纯根树没有信息量)
  if (root.children.length === 0) {
    issues.push(error('思维导图根节点没有任何分支,无法体现层级结构', 'MINDMAP_ROOT_EMPTY', [root.id]));
  }
  // 总节点数:太少不成图(Generate 场景至少要能表达一个主题的多面展开)
  if (m.total < 4) {
    issues.push(error(`思维导图总节点数过少(${m.total} < 4),至少展开到 5 个节点`, 'MINDMAP_TOO_SMALL'));
  } else if (m.total > 40) {
    // 超大树前端排版会失衡,交 Rewriter 收敛(提示词约束 5~40)
    issues.push(error(`思维导图总节点数过多(${m.total} > 40),请收敛合并同类分支`, 'MINDMAP_TOO_LARGE'));
  }
  // 深度:过浅说明没有真正展开;过深阅读性差
  if (m.maxDepth < 2) {
    issues.push(error('思维导图深度不足(仅 1 层),至少展开 2 层', 'MINDMAP_TOO_SHALLOW'));
  } else if (m.maxDepth > 5) {
    issues.push(error(`思维导图深度过深(${m.maxDepth} 层 > 5),请把过深的分支上提合并`, 'MINDMAP_TOO_DEEP'));
  }
  // id 唯一性:前端转 X6 时作节点主键,重复会导致渲染覆盖
  const duplicateIds = m.ids.filter((id, i) => m.ids.indexOf(id) !== i);
  if (duplicateIds.length > 0) {
    issues.push(error(`思维导图存在重复节点 id: ${[...new Set(duplicateIds)].slice(0, 5).join(', ')}`, 'MINDMAP_DUP_ID'));
  }
  // 单子链:父节点只有 1 个子节点说明层级冗余,应合并(错误级——结构不合理且易修正)
  if (m.singleChildParents.length > 0) {
    issues.push(
      error(
        `以下节点只有 1 个子节点,层级冗余应合并到父节点: ${m.singleChildParents.slice(0, 5).join(', ')}`,
        'MINDMAP_SINGLE_CHILD',
        m.singleChildParents,
      ),
    );
  }
  // 同父兄弟重名:warning(语义提示,不阻断)
  if (m.duplicateSiblingLabelIds.length > 0) {
    issues.push(
      warning(`同级存在重名分支: ${m.duplicateSiblingLabelIds.slice(0, 5).join(', ')}`, 'MINDMAP_DUP_SIBLING_LABEL'),
    );
  }
  return issues;
}

// ---------------------------------------------------------------------------
// table:单元格遍历指标
// ---------------------------------------------------------------------------

export interface TableMetrics {
  rowCount: number;
  colCount: number;
  /** 空字符串单元格数(模型漏写,契约要求用「—」占位) */
  emptyCells: number;
  /** 「—」占位单元格数(合法,但占比过高说明信息量不足) */
  dashCells: number;
  totalCells: number;
  /** 重复的列名 */
  duplicateColumns: string[];
  /** 首列(对象名)重复值 */
  duplicateRowHeads: string[];
}

export function measureTable(table: { columns: string[]; rows: string[][] }): TableMetrics {
  const metrics: TableMetrics = {
    rowCount: table.rows.length,
    colCount: table.columns.length,
    emptyCells: 0,
    dashCells: 0,
    totalCells: 0,
    duplicateColumns: [],
    duplicateRowHeads: [],
  };
  for (const row of table.rows) {
    for (const cell of row) {
      metrics.totalCells += 1;
      if (!cell || !cell.trim()) metrics.emptyCells += 1;
      else if (cell.trim() === '—') metrics.dashCells += 1;
    }
  }
  // 重复列名/首列重复(遍历去重)
  const seenCols = new Set<string>();
  for (const col of table.columns) {
    if (seenCols.has(col)) metrics.duplicateColumns.push(col);
    seenCols.add(col);
  }
  const seenHeads = new Set<string>();
  for (const row of table.rows) {
    const head = (row[0] ?? '').trim();
    if (head && seenHeads.has(head)) metrics.duplicateRowHeads.push(head);
    seenHeads.add(head);
  }
  return metrics;
}

function validateTable(table: { columns: string[]; rows: string[][] }): ReflectionIssue[] {
  const issues: ReflectionIssue[] = [];
  const m = measureTable(table);

  // 空字符串单元格:违反「空缺写—」契约,渲染成空格观感差(错误级,Rewriter 易修)
  if (m.emptyCells > 0) {
    issues.push(error(`表格存在 ${m.emptyCells} 个空白单元格,信息缺失处必须写「—」占位`, 'TABLE_EMPTY_CELL'));
  }
  // 「—」占比过高:说明该形态信息量不足(可能是误路由,或用户材料确实缺信息)——提示但不阻断
  if (m.totalCells > 0 && m.dashCells / m.totalCells > 0.4) {
    issues.push(
      warning(`表格「—」占位单元格占比过高(${m.dashCells}/${m.totalCells}),对比信息可能不足`, 'TABLE_TOO_SPARSE'),
    );
  }
  // 重复列名:维度概念混乱(错误级,改列名即可修复)
  if (m.duplicateColumns.length > 0) {
    issues.push(error(`表头列名重复: ${[...new Set(m.duplicateColumns)].join(', ')}`, 'TABLE_DUP_COLUMN'));
  }
  // 首列对象重名:warning(可能 legitimately 如同方案两阶段)
  if (m.duplicateRowHeads.length > 0) {
    issues.push(warning(`首列对象名重复: ${[...new Set(m.duplicateRowHeads)].join(', ')}`, 'TABLE_DUP_ROW_HEAD'));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// checklist
// ---------------------------------------------------------------------------

function validateChecklist(draft: { groups: Array<{ title: string; items: Array<{ text: string }> }> }): ReflectionIssue[] {
  const issues: ReflectionIssue[] = [];
  const totalItems = draft.groups.reduce((sum, g) => sum + g.items.length, 0);

  // 总项数:单条清单没有使用价值(不如直接 consult 回答)
  if (totalItems < 2) {
    issues.push(error(`清单总项数过少(${totalItems} < 2),请充分展开事项`, 'CHECKLIST_TOO_SMALL'));
  }
  // 分组标题重复:分组边界混乱
  const seenTitles = new Set<string>();
  const dupTitles: string[] = [];
  for (const group of draft.groups) {
    if (seenTitles.has(group.title)) dupTitles.push(group.title);
    seenTitles.add(group.title);
    // 组内重复项:同一件事列两遍(错误级,删除即可)
    const seenTexts = new Set<string>();
    for (const item of group.items) {
      if (seenTexts.has(item.text)) {
        issues.push(error(`分组「${group.title}」内存在重复事项: ${item.text.slice(0, 20)}`, 'CHECKLIST_DUP_ITEM'));
      }
      seenTexts.add(item.text);
    }
  }
  if (dupTitles.length > 0) {
    issues.push(warning(`清单分组标题重复: ${[...new Set(dupTitles)].join(', ')}`, 'CHECKLIST_DUP_GROUP'));
  }
  // 单分组过长:阅读负担(提示拆分)
  const longGroup = draft.groups.find((g) => g.items.length > 12);
  if (longGroup) {
    issues.push(warning(`分组「${longGroup.title}」事项过多(${longGroup.items.length} 项),建议拆分`, 'CHECKLIST_GROUP_TOO_LONG'));
  }
  return issues;
}

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

function validateTimeline(draft: { events: Array<{ time: string; title: string }> }): ReflectionIssue[] {
  const issues: ReflectionIssue[] = [];
  const times = draft.events.map((e) => e.time.trim());

  // 时间标记全部相同:没有时间推进度,时间线退化为清单(提示换形态或细分时间)
  if (new Set(times).size === 1 && draft.events.length > 1) {
    issues.push(warning('所有事件的时间标记完全相同,时间线缺少时间推进(可考虑改为清单形态)', 'TIMELINE_NO_PROGRESS'));
  }
  // 标题重复:同标题事件应合并或细化
  const seen = new Set<string>();
  for (const event of draft.events) {
    if (seen.has(event.title)) {
      issues.push(warning(`时间线存在重复事件标题: ${event.title.slice(0, 20)}`, 'TIMELINE_DUP_TITLE'));
    }
    seen.add(event.title);
  }
  return issues;
}

// ---------------------------------------------------------------------------
// 统一分发入口(graph 反思节点调用)
// ---------------------------------------------------------------------------

/**
 * 按形态执行结构校验(假定数据已通过 Zod 格式层;防御性兜底:遍历异常按格式错误处理,
 * 与 evaluator 第一层的容错语义一致,绝不抛出中断主链路)。
 */
export function validateArtifact(subject: { kind: NewArtifactKind; data: unknown }): ArtifactValidationResult {
  try {
    switch (subject.kind) {
      case 'mindmap':
        return finalize(validateMindmap((subject.data as { root: MindMapNode }).root));
      case 'table':
        return finalize(validateTable(subject.data as { columns: string[]; rows: string[][] }));
      case 'checklist':
        return finalize(validateChecklist(subject.data as { groups: Array<{ title: string; items: Array<{ text: string }> }> }));
      case 'timeline':
        return finalize(validateTimeline(subject.data as { events: Array<{ time: string; title: string }> }));
      default:
        return finalize([error(`未知产物形态: ${subject.kind}`, 'ARTIFACT_UNKNOWN_KIND')]);
    }
  } catch (err: any) {
    // 遍历失败说明数据形态根本不对(调用方跳过了 Zod 层):按格式问题反馈给 Rewriter
    return finalize([error(`产物结构遍历失败: ${err?.message ?? 'unknown'}`, 'ARTIFACT_TRAVERSE_FAILED')]);
  }
}
