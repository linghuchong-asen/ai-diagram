// 语图 · 画布导出工具：PNG / SVG（竞品标配能力，基于 X6 graph.toSVG）
// 设计要点：
//   · SVG 按内容包围盒 + 24px 内边距导出，透明背景（矢量、可再编辑、嵌入文档不糊）；
//   · PNG 由 SVG 光栅化，2 倍缩放提升清晰度，白底适配 Word/PPT 嵌入；
//   · 空画布时包围盒为 0，回退为当前视口尺寸，避免导出空文件；
//   · 免费档水印（options.watermark）：导出前在 SVG 注入右下角低对比品牌文案，PNG/SVG 同视觉。

import { Graph } from '@antv/x6';

/** 导出选项：watermark=true 时在导出物右下角注入免费档品牌水印（默认 false，向后兼容既有调用方） */
export interface ExportOptions {
  watermark?: boolean;
}

/** 免费档水印统一文案（展示层 / 导出层同口径） */
const WATERMARK_TEXT = '语图 Yutu · 一句话生成流程图';

/**
 * 在 SVG 根元素闭合标签前注入水印组：右下角内缩 16px、text-anchor=end、
 * 低对比 #94a3b8 / opacity 0.4；字号随画布宽缩放并夹在 10~20px，
 * 保证水印宽度约 ≤ 画布 12%，不遮挡图内容。
 */
function injectWatermark(
  svg: string,
  viewBox: { x: number; y: number; width: number; height: number },
): string {
  const fontSize = Math.max(10, Math.min(20, viewBox.width * 0.014));
  const x = viewBox.x + viewBox.width - 16;
  const y = viewBox.y + viewBox.height - 16;
  const group =
    `<g class="yutu-watermark" pointer-events="none">` +
    `<text x="${x}" y="${y}" text-anchor="end" fill="#94a3b8" opacity="0.4" ` +
    `font-family="ui-monospace, SFMono-Regular, Menlo, monospace" ` +
    `font-size="${fontSize}">${WATERMARK_TEXT}</text></g>`;
  const closeIndex = svg.lastIndexOf('</svg>');
  if (closeIndex === -1) return svg;
  return svg.slice(0, closeIndex) + group + svg.slice(closeIndex);
}

/** 触发浏览器下载一个 Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  // 释放 objectURL：延后一拍，避免个别浏览器还没开始读就被回收
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** 导出内容包围盒（空画布回退到画布区域） */
function contentBox(graph: Graph): { x: number; y: number; width: number; height: number } {
  const box = graph.getContentBBox();
  if (!box || box.width <= 0 || box.height <= 0) {
    const area = graph.getGraphArea();
    return { x: area.x, y: area.y, width: area.width, height: area.height };
  }
  const padded = box.inflate(24);
  return { x: padded.x, y: padded.y, width: padded.width, height: padded.height };
}

/** graph.toSVG 的 Promise 封装（按内容包围盒 + padding 导出尺寸；viewBox 随行返回供水印定位，避免二次解析） */
function graphToSVG(graph: Graph): Promise<{ svg: string; viewBox: ReturnType<typeof contentBox> }> {
  return new Promise((resolve, reject) => {
    try {
      const box = contentBox(graph);
      graph.toSVG(
        (svg) => resolve({ svg, viewBox: box }),
        {
          viewBox: box,
          preserveDimensions: { width: box.width, height: box.height },
        },
      );
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

/** 导出 SVG 文件（透明背景，矢量无损；watermark=true 时注入免费档水印） */
export async function exportSvg(graph: Graph, filename: string, options?: ExportOptions): Promise<void> {
  const { svg, viewBox } = await graphToSVG(graph);
  const finalSvg = options?.watermark ? injectWatermark(svg, viewBox) : svg;
  downloadBlob(new Blob([finalSvg], { type: 'image/svg+xml;charset=utf-8' }), `${filename}.svg`);
}

/**
 * 导出 PNG 文件（白底，2 倍缩放）。
 * SVG → Image → Canvas 光栅化：纯前端，无后端参与。
 */
export async function exportPng(graph: Graph, filename: string, scale = 2, options?: ExportOptions): Promise<void> {
  const { svg, viewBox } = await graphToSVG(graph);
  // 免费档水印：SVG 先注入再光栅化，与导出 SVG / 展示层同一视觉
  const finalSvg = options?.watermark ? injectWatermark(svg, viewBox) : svg;
  const dataUri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(finalSvg)}`;

  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('SVG 光栅化失败'));
    image.src = dataUri;
  });

  const width = image.naturalWidth || 800;
  const height = image.naturalHeight || 600;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D 上下文不可用');
  // 白底：适配文档/PPT 嵌入场景
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('PNG 编码失败');
  downloadBlob(blob, `${filename}.png`);
}
