// 语图技术方案 - 清单渲染器（multi-artifact-batch Round 8）
// 定位：checklist 形态在对话流内的展示组件——可交互勾选（核对场景的核心体验），
//       勾选状态仅存于组件内部（会话级体验，不落库）。
import { useState } from 'react';
import { Tag } from 'antd';
import { CheckOutlined } from '@ant-design/icons';
import type { ChecklistDraft } from '../../../../utils/aiClient';
import { checklistToMarkdown } from '../artifact-markdown';
import ArtifactCopyButton, { ArtifactDownloadButton } from './artifact-copy';

export interface ChecklistViewProps {
  draft: ChecklistDraft;
}

export default function ChecklistView({ draft }: ChecklistViewProps) {
  /** 已勾选的项 key 集合（groupIndex-itemIndex） */
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const toggle = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {draft.groups.map((group, groupIndex) => (
        <div key={`${group.title}-${groupIndex}`}>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: 'var(--yt-accent)',
              marginBottom: 6,
              letterSpacing: '0.05em',
            }}
          >
            {group.title}
            <span style={{ color: 'var(--yt-text-muted)', fontWeight: 400, marginLeft: 6, fontSize: 11 }}>
              {group.items.filter((_, i) => checked.has(`${groupIndex}-${i}`)).length}/{group.items.length}
            </span>
          </div>
          {group.items.map((item, itemIndex) => {
            const key = `${groupIndex}-${itemIndex}`;
            const isChecked = checked.has(key);
            return (
              <div
                key={key}
                role="checkbox"
                aria-checked={isChecked}
                tabIndex={0}
                onClick={() => toggle(key)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') toggle(key);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '4px 0',
                  cursor: 'pointer',
                  opacity: isChecked ? 0.55 : 1,
                }}
              >
                <span
                  style={{
                    flexShrink: 0,
                    width: 16,
                    height: 16,
                    marginTop: 1,
                    borderRadius: 4,
                    border: `1px solid ${isChecked ? 'var(--yt-accent)' : 'var(--yt-border)'}`,
                    background: isChecked ? 'var(--yt-accent)' : 'transparent',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {isChecked ? <CheckOutlined style={{ fontSize: 10, color: '#0d1426' }} /> : null}
                </span>
                <span style={{ flex: 1, fontSize: 12, color: 'var(--yt-text-primary)', lineHeight: 1.6 }}>
                  <span style={isChecked ? { textDecoration: 'line-through' } : undefined}>{item.text}</span>
                  {item.owner || item.due ? (
                    <span style={{ marginLeft: 8, whiteSpace: 'nowrap' }}>
                      {item.owner ? (
                        <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 4 }} color="cyan">
                          {item.owner}
                        </Tag>
                      ) : null}
                      {item.due ? (
                        <Tag style={{ fontSize: 10, lineHeight: '16px', marginInlineEnd: 0 }} color="geekblue">
                          {item.due}
                        </Tag>
                      ) : null}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <ArtifactCopyButton text={checklistToMarkdown(draft)} />
        <ArtifactDownloadButton kind="checklist" payload={draft} />
      </div>
    </div>
  );
}
