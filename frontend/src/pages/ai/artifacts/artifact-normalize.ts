// 语图技术方案 - 多形态产物脏数据归一化（multi-artifact-batch Round 7）
// 定位：网络层不做 schema 校验（aiClient 只做裸 JSON 透传），渲染层消费前必须归一化，
//       保证「后端异常/字段漂移时前端不白屏、不抛异常」——与 transform/to-x6.ts 的降级哲学一致。
// 原则：① 纯函数、不改入参；② 缺字段/类型错按最小可用值兜底（不猜内容）；③ 归一化不放大脏数据。
import type {
  ArtifactKind,
  ChecklistDraft,
  MindMapDraft,
  MindMapNode,
  TableDraft,
  TimelineDraft,
} from '../../../utils/aiClient';

/** 归一化结果：payload 为 null 表示该形态数据完全不可用（调用方退化为文本提示） */
export interface NormalizedArtifact<T> {
  payload: T | null;
  /** 归一化过程中做的兜底动作明细（可观测/可回显） */
  fixes: string[];
}

/** 安全字符串：null/undefined/非字符串 → fallback */
function safeString(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

/** 安全字符串数组：过滤非字符串与空串 */
function safeStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && !!v.trim()) : [];
}

// ---------------------------------------------------------------------------
// mindmap：递归修复 id/label/children（id 缺失自动补齐且保证全树唯一）
// ---------------------------------------------------------------------------

export function normalizeMindmap(raw: unknown): NormalizedArtifact<MindMapDraft> {
  const fixes: string[] = [];
  const rootRaw = (raw as { root?: unknown } | null)?.root;
  if (!rootRaw || typeof rootRaw !== 'object') {
    return { payload: null, fixes: ['思维导图缺少 root 结构'] };
  }
  let idCounter = 0;
  const usedIds = new Set<string>();
  /** 生成不与既有 id 冲突的自动 id(自增序列跳过已占用值) */
  const genId = (): string => {
    idCounter += 1;
    while (usedIds.has(`m${idCounter}`)) idCounter += 1;
    return `m${idCounter}`;
  };
  const fixNode = (node: unknown, path: string): MindMapNode | null => {
    if (!node || typeof node !== 'object') {
      fixes.push(`${path} 节点结构非法,已丢弃`);
      return null;
    }
    const source = node as { id?: unknown; label?: unknown; children?: unknown };
    // label 兜底:非字符串/空 → 未命名(不丢弃节点,保留树形)
    const label = safeString(source.label, '未命名');
    if (label === '未命名' && typeof source.label !== 'string') fixes.push(`${path} label 缺失,已按「未命名」兜底`);
    // id 兜底:缺失/重复 → 自动生成 m{n}(X6 主键必须唯一)
    let id = typeof source.id === 'string' && source.id && !usedIds.has(source.id) ? source.id : '';
    if (!id) {
      id = genId();
      fixes.push(`${path}(${label}) id 缺失或重复,已自动补齐 ${id}`);
    }
    usedIds.add(id);
    const childrenRaw = Array.isArray(source.children) ? source.children : [];
    if (childrenRaw.length !== (source.children as unknown[] | undefined)?.length) fixes.push(`${path} children 非数组,已按空处理`);
    const children = childrenRaw.map((child, i) => fixNode(child, `${path}/${i}`)).filter((c): c is MindMapNode => !!c);
    return { id, label, children };
  };
  const root = fixNode(rootRaw, 'root');
  if (!root) return { payload: null, fixes };
  // 全空树兜底:根节点至少保留,可渲染单节点
  return { payload: { root }, fixes };
}

// ---------------------------------------------------------------------------
// table：列/行齐整化（短行补「—」,长行截断;全空 → null）
// ---------------------------------------------------------------------------

export function normalizeTable(raw: unknown): NormalizedArtifact<TableDraft> {
  const fixes: string[] = [];
  const source = (raw ?? {}) as { columns?: unknown; rows?: unknown; conclusion?: unknown };
  const columns = safeStringArray(source.columns);
  if (columns.length === 0) return { payload: null, fixes: ['表格缺少有效列头'] };
  if (columns.length !== (Array.isArray(source.columns) ? source.columns.length : 0)) {
    fixes.push('部分列头非法已过滤');
  }
  const rowsRaw = Array.isArray(source.rows) ? source.rows : [];
  const rows: string[][] = [];
  for (const row of rowsRaw) {
    if (!Array.isArray(row)) {
      fixes.push('某行非数组,已丢弃');
      continue;
    }
    const cells = row.map((cell) => safeString(cell, '—'));
    if (cells.length < columns.length) {
      fixes.push(`某行仅 ${cells.length} 列,已补「—」对齐`);
      while (cells.length < columns.length) cells.push('—');
    } else if (cells.length > columns.length) {
      fixes.push(`某行超出 ${cells.length - columns.length} 列,已截断`);
    }
    rows.push(cells.slice(0, columns.length));
  }
  if (rows.length === 0) return { payload: null, fixes: [...fixes, '表格没有可用数据行'] };
  const conclusion = typeof source.conclusion === 'string' && source.conclusion.trim() ? source.conclusion : undefined;
  return { payload: { columns, rows, conclusion }, fixes };
}

// ---------------------------------------------------------------------------
// checklist：分组/项结构兜底（组内空项丢弃;组全空丢弃;全空 → null）
// ---------------------------------------------------------------------------

export function normalizeChecklist(raw: unknown): NormalizedArtifact<ChecklistDraft> {
  const fixes: string[] = [];
  const groupsRaw = Array.isArray((raw as { groups?: unknown })?.groups) ? (raw as { groups: unknown[] }).groups : [];
  const groups: ChecklistDraft['groups'] = [];
  for (const group of groupsRaw) {
    if (!group || typeof group !== 'object') {
      fixes.push('某分组结构非法,已丢弃');
      continue;
    }
    const title = safeString((group as { title?: unknown }).title, '未分组');
    const itemsRaw = Array.isArray((group as { items?: unknown }).items) ? (group as { items: unknown[] }).items : [];
    const items = itemsRaw
      .filter((item) => !!item && typeof item === 'object')
      .map((item) => {
        const record = item as { text?: unknown; owner?: unknown; due?: unknown };
        return {
          text: safeString(record.text, '（空事项）'),
          owner: typeof record.owner === 'string' && record.owner.trim() ? record.owner : undefined,
          due: typeof record.due === 'string' && record.due.trim() ? record.due : undefined,
        };
      });
    if (items.length === 0) {
      fixes.push(`分组「${title}」无有效项,已丢弃`);
      continue;
    }
    groups.push({ title, items });
  }
  if (groups.length === 0) return { payload: null, fixes: [...fixes, '清单没有可用分组'] };
  return { payload: { groups }, fixes };
}

// ---------------------------------------------------------------------------
// timeline：事件结构兜底（time/title 缺失补占位;全空 → null）
// ---------------------------------------------------------------------------

export function normalizeTimeline(raw: unknown): NormalizedArtifact<TimelineDraft> {
  const fixes: string[] = [];
  const eventsRaw = Array.isArray((raw as { events?: unknown })?.events) ? (raw as { events: unknown[] }).events : [];
  const events: TimelineDraft['events'] = [];
  for (const event of eventsRaw) {
    if (!event || typeof event !== 'object') {
      fixes.push('某事件结构非法,已丢弃');
      continue;
    }
    const record = event as { time?: unknown; title?: unknown; detail?: unknown };
    const title = safeString(record.title, '（无标题）');
    const time = safeString(record.time, '时间待定');
    if (time === '时间待定') fixes.push(`事件「${title}」缺时间标记,已按「时间待定」兜底`);
    events.push({
      time,
      title,
      detail: typeof record.detail === 'string' && record.detail.trim() ? record.detail : undefined,
    });
  }
  if (events.length === 0) return { payload: null, fixes: [...fixes, '时间线没有可用事件'] };
  return { payload: { events }, fixes };
}

/** 按形态分发归一化（flowchart 不在此列——走 transform/to-x6.ts 的 normalizeFlowDraft 既有链路） */
export function normalizeArtifact(kind: Exclude<ArtifactKind, 'flowchart'>, raw: unknown): NormalizedArtifact<unknown> {
  switch (kind) {
    case 'mindmap':
      return normalizeMindmap(raw);
    case 'table':
      return normalizeTable(raw);
    case 'checklist':
      return normalizeChecklist(raw);
    case 'timeline':
      return normalizeTimeline(raw);
    default:
      return { payload: null, fixes: [`未知形态 ${String(kind)}`] };
  }
}
