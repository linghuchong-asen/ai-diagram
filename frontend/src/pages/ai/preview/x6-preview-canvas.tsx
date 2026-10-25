// 语图技术方案 - Task 5.5：generate 结果只读 X6 预览
// 用独立 Graph 实例（interacting:false）渲染 flowDraftToX6 的输出，不触碰主画布；
// 用户点击「应用到画布」后才由父组件写入主图。卸载时 dispose 预览实例。

import { useEffect, useRef } from 'react';
import { Graph } from '@antv/x6';
import type { X6GraphData } from '../transform/types';

export interface X6FlowPreviewProps {
  /** flowDraftToX6 的输出（已含 autoLayout 坐标） */
  data: X6GraphData;
  /** 预览画布高度，默认 260 */
  height?: number;
}

export default function X6FlowPreview({ data, height = 260 }: X6FlowPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return undefined;

    const preview = new Graph({
      container,
      width: container.clientWidth || 360,
      height,
      interacting: false, // 只读预览：禁用节点拖拽 / 连线 / 框选等一切交互
      background: { color: '#0d1426' },
      grid: { size: 10, visible: true, type: 'mesh', args: { color: '#1c2a47', thickness: 1 } },
    });
    // X6NodeData（纯数据）与 X6 运行时 Node.Metadata 的 attrs/ports 结构类型声明不兼容，
    // 但运行时结构完全一致（to-x6.ts 的输出即为此设计），此处做一次整体断言。
    preview.fromJSON({ nodes: data.nodes, edges: data.edges } as unknown as Parameters<Graph['fromJSON']>[0]);
    preview.centerContent();

    return () => {
      preview.dispose();
    };
  }, [data, height]);

  return (
    <div
      ref={containerRef}
      style={{ width: '100%', height, border: '1px solid var(--yt-border)', borderRadius: 8, overflow: 'hidden' }}
    />
  );
}
