// 语图技术方案 - 产物 Markdown 文件下载（competitor-driven-evolution-batch Round 10）
// 背景：竞品把「带走」做全（Napkin 导出 PNG/SVG/PDF/PPT）；语图非画布产物的自然归宿是
//       Markdown（可进 Notion/Obsidian/GitHub/飞书文档）。R8 已有剪贴板复制,本轮补文件下载。
// 原则:构建文本纯函数可测;DOM 下载动作做环境守卫(非浏览器返回 false,不抛异常)。
import type { ArtifactKind, ChecklistDraft, FlowDraft, MindMapDraft, TableDraft, TimelineDraft } from '../../../utils/aiClient';
import { flowDraftToMermaid } from '../../../utils/toMermaid';
import { mindmapToMarkdown, tableToMarkdown, checklistToMarkdown, timelineToMarkdown } from './artifact-markdown';
import { ARTIFACT_KIND_LABEL } from './artifact-meta';

/** 形态 → 文件名中缀（与 ARTIFACT_KIND_LABEL 一致,避免英文形态词对中文用户不友好） */
function kindLabelFor(kind: ArtifactKind): string {
  return ARTIFACT_KIND_LABEL[kind] ?? kind;
}

/**
 * 生成下载文件名:语图-形态-时间戳.md。
 * 时间戳格式 YYYYMMDD-HHmmss;date 参数可注入保证可测性;文件名剔除路径不安全字符。
 */
export function artifactFileName(kind: ArtifactKind, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `语图-${kindLabelFor(kind)}-${stamp}.md`;
}

/**
 * 任意形态产物 → Markdown 文本（flowchart 输出 mermaid 代码块,GitHub/Obsidian 可直接渲染）。
 * payload 与形态不符时返回 null(调用方提示),不猜测。
 */
export function buildArtifactMarkdown(kind: ArtifactKind, payload: unknown): string | null {
  try {
    switch (kind) {
      case 'flowchart':
        return ['<!-- 语图流程图(Mermaid,可直接粘贴到 GitHub/Notion/Obsidian 渲染) -->', '```mermaid', flowDraftToMermaid(payload as FlowDraft), '```'].join('\n');
      case 'mindmap':
        return mindmapToMarkdown(payload as MindMapDraft);
      case 'table':
        return tableToMarkdown(payload as TableDraft);
      case 'checklist':
        return checklistToMarkdown(payload as ChecklistDraft);
      case 'timeline':
        return timelineToMarkdown(payload as TimelineDraft);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

/**
 * 触发浏览器下载（Blob + 隐藏 <a>）。
 * 非浏览器环境(check/SSR)返回 false 不抛异常;文件名做最小清洗(去路径分隔符)。
 */
export function downloadTextFile(filename: string, text: string, mime = 'text/markdown;charset=utf-8'): boolean {
  if (typeof document === 'undefined' || typeof URL?.createObjectURL !== 'function') return false;
  try {
    const safeName = filename.replace(/[\\/:*?"<>|]/g, '_');
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = safeName;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    // 释放 objectURL:延迟到下一个宏任务,避免个别浏览器点击事件尚未消费完
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    return true;
  } catch {
    return false;
  }
}

/** 一步到位:形态+产物 → 下载(构建失败或非浏览器环境返回 false) */
export function downloadArtifactMarkdown(kind: ArtifactKind, payload: unknown, date: Date = new Date()): boolean {
  const markdown = buildArtifactMarkdown(kind, payload);
  if (markdown === null) return false;
  return downloadTextFile(artifactFileName(kind, date), markdown);
}
