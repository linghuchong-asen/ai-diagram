// 语图技术方案 - 产物消息气泡分发器（multi-artifact-batch Round 8）
// 定位：AI 浮窗消息流内按形态分发渲染 table/checklist/timeline 三种非画布产物；
//       mindmap 走画布预览链路（不进消息流），此处仅作防御性兜底展示。
import type { ExtractedArtifact } from '../artifact-meta';
import TableView from './table-view';
import ChecklistView from './checklist-view';
import TimelineView from './timeline-view';

export interface ArtifactBubbleProps {
  artifact: ExtractedArtifact;
}

export default function ArtifactBubble({ artifact }: ArtifactBubbleProps) {
  switch (artifact.kind) {
    case 'table':
      return <TableView draft={artifact.payload} />;
    case 'checklist':
      return <ChecklistView draft={artifact.payload} />;
    case 'timeline':
      return <TimelineView draft={artifact.payload} />;
    default:
      // 防御:mindmap 理论上不进消息流;兜底提示避免白块
      return <div style={{ fontSize: 12, color: 'var(--yt-text-muted)' }}>（思维导图请在画布预览区查看）</div>;
  }
}
