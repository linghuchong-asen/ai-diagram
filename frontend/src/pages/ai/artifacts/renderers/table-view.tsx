// 语图技术方案 - 对比表格渲染器（multi-artifact-batch Round 8 + competitor-driven-evolution-batch Round 9）
// 定位：table 形态在对话流内的展示组件。不使用 antd Table（浅色主题与浮窗 Neon Dark 冲突），
//       采用自绘 markup + tech-theme CSS 变量，保证在深色浮窗/移动端全屏下观感一致。
// Round 9 追加：单元格行内编辑（点击进入编辑，Enter/失焦提交）——AI 给的是初稿，
//       用户顺手改两个单元格再复制带走，是「强初稿 + 轻修正」竞品共识的最低成本实现。
//       编辑仅存组件内部状态；Markdown 导出/打分消费「应用编辑后」的表格。
import { useMemo, useState } from 'react';
import type { TableDraft } from '../../../../utils/aiClient';
import { tableToMarkdown } from '../artifact-markdown';
import ArtifactCopyButton, { ArtifactDownloadButton } from './artifact-copy';

export interface TableViewProps {
  draft: TableDraft;
}

export default function TableView({ draft }: TableViewProps) {
  const wide = draft.columns.length > 4; // 宽表横向滚动，避免挤压浮窗
  /** 行内编辑值：`行-列` → 新文本（Round 9） */
  const [edits, setEdits] = useState<Record<string, string>>({});
  /** 当前正在编辑的单元格 key */
  const [editingCell, setEditingCell] = useState<string | null>(null);

  const cellKey = (row: number, col: number) => `${row}-${col}`;
  const cellText = (row: number, col: number, fallback: string) => edits[cellKey(row, col)] ?? fallback;

  /** 应用编辑后的表格副本（Markdown 导出/后续消费用，不改入参） */
  const editedDraft: TableDraft = useMemo(
    () => ({
      ...draft,
      rows: draft.rows.map((row, r) => row.map((cell, c) => cellText(r, c, cell))),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draft, edits],
  );

  const commitEdit = (key: string, value: string) => {
    const [rowIndex, colIndex] = key.split('-').map(Number);
    const original = draft.rows[rowIndex!]?.[colIndex!];
    setEdits((prev) => {
      const next = { ...prev };
      if (value === original) delete next[key];
      else next[key] = value;
      return next;
    });
    setEditingCell(null);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {edits && Object.keys(edits).length > 0 ? (
        <div className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-accent)', opacity: 0.8 }}>
          已本地修改 {Object.keys(edits).length} 处（复制/导出按修改后内容）
        </div>
      ) : null}
      <div style={{ overflowX: wide ? 'auto' : undefined }}>
        <table
          style={{
            borderCollapse: 'collapse',
            width: '100%',
            fontSize: 12,
            color: 'var(--yt-text-primary)',
            minWidth: wide ? 420 : undefined,
          }}
        >
          <thead>
            <tr>
              {draft.columns.map((column, index) => (
                <th
                  key={`${column}-${index}`}
                  style={{
                    border: '1px solid var(--yt-border)',
                    padding: '6px 10px',
                    textAlign: 'left',
                    background: 'rgba(124, 134, 232, 0.10)',
                    color: 'var(--yt-accent)',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {draft.rows.map((row, rowIndex) => (
              <tr key={rowIndex}>
                {row.map((cell, cellIndex) => {
                  const key = cellKey(rowIndex, cellIndex);
                  const text = cellText(rowIndex, cellIndex, cell);
                  if (editingCell === key) {
                    return (
                      <td key={cellIndex} style={{ border: '1px solid var(--yt-accent)', padding: 2 }}>
                        <input
                          autoFocus
                          value={text}
                          onChange={(event) => setEdits((prev) => ({ ...prev, [key]: event.target.value }))}
                          onBlur={(event) => commitEdit(key, event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter') commitEdit(key, (event.target as HTMLInputElement).value);
                          }}
                          style={{
                            width: '100%',
                            boxSizing: 'border-box',
                            border: 'none',
                            outline: 'none',
                            background: 'rgba(255, 255, 255, 0.06)',
                            color: 'var(--yt-text-primary)',
                            fontSize: 12,
                            padding: '4px 6px',
                            borderRadius: 4,
                          }}
                        />
                      </td>
                    );
                  }
                  return (
                    <td
                      key={cellIndex}
                      title="点击编辑"
                      onClick={() => setEditingCell(key)}
                      style={{
                        border: '1px solid var(--yt-border)',
                        padding: '6px 10px',
                        cursor: 'text',
                        // 「—」占位弱化显示：信息缺失不该与实数据同等醒目
                        color: text.trim() === '—' ? 'var(--yt-text-muted)' : 'var(--yt-text-primary)',
                      }}
                    >
                      {text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {draft.conclusion ? (
        <div
          style={{
            borderLeft: '3px solid var(--yt-accent)',
            background: 'rgba(124, 134, 232, 0.07)',
            padding: '6px 10px',
            fontSize: 12,
            color: 'var(--yt-text-primary)',
            borderRadius: 4,
          }}
        >
          <span className="yt-mono" style={{ color: 'var(--yt-accent)', marginRight: 6, fontSize: 10 }}>
            CONCLUSION
          </span>
          {draft.conclusion}
        </div>
      ) : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <ArtifactCopyButton text={tableToMarkdown(editedDraft)} />
        <ArtifactDownloadButton kind="table" payload={editedDraft} />
      </div>
    </div>
  );
}
