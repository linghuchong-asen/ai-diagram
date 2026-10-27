// 语图技术方案 - 多形态产物 Markdown 导出（multi-artifact-batch Round 7）
// 定位：非画布形态（table/checklist/timeline）与 mindmap 的「带走」出口——
//       复制为 Markdown 后可直接贴进笔记/文档/PR（解决「不是图」的归宿问题）。
// 原则：纯函数;表格严格对齐（| 分隔 + 表头分隔行）;清单用 GitHub 任务列表语法（- [ ]）。
import type { ChecklistDraft, MindMapDraft, MindMapNode, TableDraft, TimelineDraft } from '../../../utils/aiClient';

/** 表格单元格转义:竖线会破坏 Markdown 表格结构,替换为全角竖线 */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '｜').replace(/\n/g, ' ');
}

/** mindmap → 多级无序列表（层级 = 缩进深度） */
export function mindmapToMarkdown(draft: MindMapDraft): string {
  const lines: string[] = [];
  const walk = (node: MindMapNode, depth: number) => {
    lines.push(`${'  '.repeat(depth - 1)}- ${node.label}`);
    for (const child of node.children) walk(child, depth + 1);
  };
  walk(draft.root, 1);
  return lines.join('\n');
}

/** table → Markdown 表格（+ 可选结论行） */
export function tableToMarkdown(draft: TableDraft): string {
  const lines: string[] = [];
  lines.push(`| ${draft.columns.map(escapeCell).join(' | ')} |`);
  // 表头分隔行:列数必须与表头一致,否则渲染端不认为是表格
  lines.push(`| ${draft.columns.map(() => '---').join(' | ')} |`);
  for (const row of draft.rows) {
    lines.push(`| ${row.map(escapeCell).join(' | ')} |`);
  }
  if (draft.conclusion) lines.push('', `> 结论：${draft.conclusion}`);
  return lines.join('\n');
}

/** checklist → 分组任务列表（GitHub 任务语法,粘贴后可直接勾选） */
export function checklistToMarkdown(draft: ChecklistDraft): string {
  const lines: string[] = [];
  for (const group of draft.groups) {
    lines.push(`### ${group.title}`);
    for (const item of group.items) {
      // 责任人/截止以中括号后缀呈现,保留信息但不破坏勾选语法
      const meta = [item.owner ? `@${item.owner}` : '', item.due ? `⏰${item.due}` : ''].filter(Boolean).join(' ');
      lines.push(`- [ ] ${item.text}${meta ? `（${meta}）` : ''}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

/** timeline → 有序列表（时间前缀,保持事件顺序;序号递增,纯文本阅读也成立） */
export function timelineToMarkdown(draft: TimelineDraft): string {
  return draft.events
    .map((event, index) => `${index + 1}. **${event.time}** ${event.title}${event.detail ? `：${event.detail}` : ''}`)
    .join('\n');
}
