// 语图技术方案 - 时间线渲染器（multi-artifact-batch Round 8）
// 定位：timeline 形态在对话流内的展示组件——纵向时间轴（圆点 + 竖线），
//       自绘 markup 保持 Neon Dark 观感（antd Timeline 为浅色主题）。
import type { TimelineDraft } from '../../../../utils/aiClient';
import { timelineToMarkdown } from '../artifact-markdown';
import ArtifactCopyButton, { ArtifactDownloadButton } from './artifact-copy';

export interface TimelineViewProps {
  draft: TimelineDraft;
}

export default function TimelineView({ draft }: TimelineViewProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', paddingLeft: 4 }}>
        {draft.events.map((event, index) => (
          <div key={index} style={{ display: 'flex', gap: 10, position: 'relative', paddingBottom: index === draft.events.length - 1 ? 0 : 14 }}>
            {/* 时间轴竖线:最后一项不延伸 */}
            {index < draft.events.length - 1 ? (
              <span
                style={{
                  position: 'absolute',
                  left: 5,
                  top: 14,
                  bottom: -2,
                  width: 1,
                  background: 'var(--yt-border)',
                }}
              />
            ) : null}
            {/* 时间轴圆点 */}
            <span
              style={{
                flexShrink: 0,
                width: 11,
                height: 11,
                marginTop: 4,
                borderRadius: '50%',
                border: '2px solid var(--yt-accent)',
                background: '#0d1426',
                boxShadow: '0 0 6px rgba(34, 211, 238, 0.5)',
              }}
            />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-accent)', letterSpacing: '0.08em' }}>
                {event.time}
              </span>
              <span style={{ fontSize: 12, color: 'var(--yt-text-primary)', marginLeft: 8, fontWeight: 600 }}>
                {event.title}
              </span>
              {event.detail ? (
                <span style={{ display: 'block', fontSize: 11, color: 'var(--yt-text-secondary)', marginTop: 2, lineHeight: 1.6 }}>
                  {event.detail}
                </span>
              ) : null}
            </span>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <ArtifactCopyButton text={timelineToMarkdown(draft)} />
        <ArtifactDownloadButton kind="timeline" payload={draft} />
      </div>
    </div>
  );
}
