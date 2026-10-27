// 语图技术方案 - 产物复制/下载按钮（multi-artifact-batch Round 8 + competitor-driven-evolution-batch Round 10）
// 定位：非画布形态的「带走」出口——复制为 Markdown（贴进笔记/文档/PR）+ 下载 .md 文件
//       （可进 Notion/Obsidian/GitHub）。剪贴板/下载失败时降级为可读提示。
import { useState } from 'react';
import { Button, message } from 'antd';
import { CopyOutlined, CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import type { ArtifactKind } from '../../../../utils/aiClient';
import { downloadArtifactMarkdown } from '../download-artifact';

export interface ArtifactCopyButtonProps {
  /** 待复制的 Markdown 文本 */
  text: string;
  /** 按钮文字（默认「复制 Markdown」） */
  label?: string;
}

export default function ArtifactCopyButton({ text, label = '复制 Markdown' }: ArtifactCopyButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      // 现代浏览器剪贴板 API;失败(非 https/权限)时降级选区复制
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopied(true);
      message.success({ content: '已复制为 Markdown，可粘贴到笔记/文档', duration: 2 });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      message.error({ content: '复制失败，请手动选择文本复制', duration: 2 });
    }
  };

  return (
    <Button
      size="small"
      icon={copied ? <CheckOutlined /> : <CopyOutlined />}
      onClick={() => void handleCopy()}
      style={{ borderColor: 'var(--yt-border)', color: copied ? 'var(--yt-accent)' : 'var(--yt-text-secondary)', background: 'rgba(255, 255, 255, 0.04)' }}
    >
      {copied ? '已复制' : label}
    </Button>
  );
}

/** Round 10：下载 .md 文件按钮（与复制按钮并排,共同构成「带走」出口） */
export interface ArtifactDownloadButtonProps {
  kind: ArtifactKind;
  /** 产物本体(构建 Markdown 用) */
  payload: unknown;
  /** 按钮文字,默认「下载 .md」 */
  label?: string;
}

export function ArtifactDownloadButton({ kind, payload, label = '下载 .md' }: ArtifactDownloadButtonProps) {
  const handleDownload = () => {
    const ok = downloadArtifactMarkdown(kind, payload);
    if (ok) {
      message.success({ content: '已开始下载 Markdown 文件', duration: 2 });
    } else {
      message.error({ content: '下载失败,可先复制 Markdown 再自行保存', duration: 3 });
    }
  };
  return (
    <Button
      size="small"
      icon={<DownloadOutlined />}
      onClick={handleDownload}
      style={{ borderColor: 'var(--yt-border)', color: 'var(--yt-text-secondary)', background: 'rgba(255, 255, 255, 0.04)' }}
    >
      {label}
    </Button>
  );
}
