// 语图技术方案 - 多形态产物元信息与结果提取（multi-artifact-batch Round 8）
// 定位：浮窗「按 artifactKind 分发」所需的纯逻辑：形态中文名、结果摘要文案、payload 提取。
//       与 __checks__ 断言兼容（纯函数、无 React 依赖）。
// competitor-driven-evolution-batch Round 12 追加 generatePayloadOf：
//       按 artifactKind 取出结果携带的 Draft 本体（本地草稿箱列表的复制/下载出口消费）。
import type {
  AiResult,
  ArtifactKind,
  ChecklistDraft,
  FlowDraft,
  GenerateResult,
  MindMapDraft,
  TableDraft,
  TimelineDraft,
} from '../../../utils/aiClient';
import { layoutMindmap } from './mindmap-layout';
import { normalizeMindmap, normalizeTable, normalizeChecklist, normalizeTimeline } from './artifact-normalize';

/** 形态中文名（摘要文案/快捷 chips/预览标题共用） */
export const ARTIFACT_KIND_LABEL: Record<ArtifactKind, string> = {
  flowchart: '流程图',
  mindmap: '思维导图',
  table: '对比表格',
  checklist: '清单',
  timeline: '时间线',
};

/** 非 flowchart 形态集合（类型收窄用） */
export type NonFlowchartKind = Exclude<ArtifactKind, 'flowchart'>;

/**
 * 从 generate 结果中提取「归一化后的产物 + 形态」。
 * 返回 null 表示该结果不是多形态产物（flowchart 走既有链路）或数据完全不可用。
 */
export type ExtractedArtifact =
  | { kind: 'mindmap'; payload: MindMapDraft }
  | { kind: 'table'; payload: TableDraft }
  | { kind: 'checklist'; payload: ChecklistDraft }
  | { kind: 'timeline'; payload: TimelineDraft };

export function extractArtifact(result: GenerateResult): ExtractedArtifact | null {
  const kind = result.artifactKind ?? 'flowchart';
  if (kind === 'flowchart') return null;
  switch (kind) {
    case 'mindmap': {
      const { payload } = normalizeMindmap(result.mindmapDraft);
      return payload ? { kind, payload } : null;
    }
    case 'table': {
      const { payload } = normalizeTable(result.tableDraft);
      return payload ? { kind, payload } : null;
    }
    case 'checklist': {
      const { payload } = normalizeChecklist(result.checklistDraft);
      return payload ? { kind, payload } : null;
    }
    case 'timeline': {
      const { payload } = normalizeTimeline(result.timelineDraft);
      return payload ? { kind, payload } : null;
    }
    default:
      return null;
  }
}

/**
 * competitor-driven-evolution-batch Round 12：按 artifactKind 从 generate 结果中
 * 取出产物本体（Draft）。草稿箱列表的「复制/下载」出口消费；形态与字段不配对时返回 null
 * （不猜测、不兜底，由调用方决定是否隐藏操作）。
 */
export function generatePayloadOf(
  result: AiResult,
): FlowDraft | MindMapDraft | TableDraft | ChecklistDraft | TimelineDraft | null {
  if (result.kind !== 'generate') return null;
  const generate = result as GenerateResult;
  switch (generate.artifactKind ?? 'flowchart') {
    case 'mindmap':
      return generate.mindmapDraft ?? null;
    case 'table':
      return generate.tableDraft ?? null;
    case 'checklist':
      return generate.checklistDraft ?? null;
    case 'timeline':
      return generate.timelineDraft ?? null;
    case 'flowchart':
      // 兼容期 flowDraft 可能缺省（调用方契约保证存在），容错返回 null
      return generate.flowDraft ?? null;
    default:
      return null;
  }
}

/** 各形态的生成结果摘要（消息流文案,与 summarizeGeneratePreview 的角色一致） */
export function summarizeArtifact(artifact: ExtractedArtifact): string {
  switch (artifact.kind) {
    case 'mindmap': {
      const layout = layoutMindmap(artifact.payload);
      const maxDepth = layout.nodes.reduce((max, n) => Math.max(max, n.depth), 0);
      return `已生成思维导图：${layout.nodes.length} 个节点、最深 ${maxDepth} 层。预览确认后可应用到画布，也可复制为 Markdown 大纲。`;
    }
    case 'table': {
      const { columns, rows, conclusion } = artifact.payload;
      return (
        `已生成对比表格：${columns.length} 列 × ${rows.length} 行${conclusion ? '，含推荐结论' : ''}。` +
        '内容展示在下方，可一键复制为 Markdown 表格。'
      );
    }
    case 'checklist': {
      const total = artifact.payload.groups.reduce((sum, g) => sum + g.items.length, 0);
      return `已生成清单：${artifact.payload.groups.length} 个分组、共 ${total} 项。可直接勾选核对，也可复制为 Markdown 任务列表。`;
    }
    case 'timeline':
      return `已生成时间线：${artifact.payload.events.length} 个事件（按时间先后排列）。可一键复制为 Markdown 行程表。`;
    default:
      return '已生成产物。';
  }
}
