/*
 * @Description: 分享卡工厂（魔性传播批次一 · 赌注一公共地基）
 * 把「X6 画布图 + 提示词 + 品牌句」合成一张 1080×1440（3:4）的暗色 Neon 风 PNG 卡片。
 * 战略背景：无备案域名下链接在微信内不可靠，而纯图片分享不受外链监管 ——
 *   卡片是语图最主要的传播介质，底部品牌句常驻（这是分享物署名而非水印，付费不移除）。
 * 复用关系：SVG 源复用 utils/exportImage 的 renderGraphToSvg；
 *   drawCardBackground/wrapText 为通用绘制 helper，年报卡（Round B）等同形态消费方复用。
 */

import { Graph } from "@antv/x6";
import { renderGraphToSvg } from "./exportImage";

/** 卡片固定尺寸（3:4，适配小红书/朋友圈竖版） */
export const CARD_WIDTH = 1080;
export const CARD_HEIGHT = 1440;

/** 卡片主题色（与站点 Neon Dark 同源） */
const CARD_COLORS = {
  bg: "#0b0c0e",
  bgGlow1: "rgba(124, 134, 232, 0.10)",
  bgGlow2: "rgba(124, 134, 232, 0.06)",
  grid: "rgba(148, 163, 184, 0.05)",
  title: "#f0f1f3",
  sub: "#94a3b8",
  accent: "#7c86e8",
  frame: "rgba(124, 134, 232, 0.30)",
} as const;

/**
 * CJK 友好的按像素宽度折行（中英文混排逐字符累积测量；英文长词不做断词，简单可靠）。
 * 返回行数组；超过 maxLines 时截断并补省略号。
 */
export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = "";
  const chars = Array.from(text.trim());
  for (let i = 0; i < chars.length; i++) {
    const candidate = current + chars[i];
    if (ctx.measureText(candidate).width > maxWidth && current) {
      lines.push(current);
      current = chars[i];
      if (lines.length >= maxLines) break;
    } else {
      current = candidate;
    }
  }
  if (lines.length < maxLines && current) lines.push(current);
  // 截断补省略号：原文比能放下的多时，末行以 … 收尾
  const consumed = lines.join("");
  if (consumed.length < text.trim().length && lines.length > 0) {
    lines[lines.length - 1] = lines[lines.length - 1].slice(0, -1) + "…";
  }
  return lines;
}

/** 画卡片底：纯色 + 双光晕 + 细网格（与站点 yt-atmo 视觉同源但更克制） */
export function drawCardBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = CARD_COLORS.bg;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 两个对角光晕（径向渐变）
  const glow1 = ctx.createRadialGradient(140, 120, 0, 140, 120, 620);
  glow1.addColorStop(0, CARD_COLORS.bgGlow1);
  glow1.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow1;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  const glow2 = ctx.createRadialGradient(CARD_WIDTH - 120, CARD_HEIGHT - 100, 0, CARD_WIDTH - 120, CARD_HEIGHT - 100, 640);
  glow2.addColorStop(0, CARD_COLORS.bgGlow2);
  glow2.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow2;
  ctx.fillRect(0, 0, CARD_WIDTH, CARD_HEIGHT);

  // 细网格（每 60px 一条，透明度极低）
  ctx.strokeStyle = CARD_COLORS.grid;
  ctx.lineWidth = 1;
  for (let x = 60; x < CARD_WIDTH; x += 60) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, CARD_HEIGHT);
    ctx.stroke();
  }
  for (let y = 60; y < CARD_HEIGHT; y += 60) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CARD_WIDTH, y);
    ctx.stroke();
  }
}

/** 画卡片页眉/页脚（品牌句 + 站点地址回流入口；年报卡等同形态复用） */
export function drawCardBrand(ctx: CanvasRenderingContext2D, tag: string): void {
  const padding = 64;
  // 顶部等宽小标签
  ctx.fillStyle = CARD_COLORS.accent;
  ctx.globalAlpha = 0.85;
  ctx.font = "600 26px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(tag, padding, 56);
  ctx.globalAlpha = 1;

  // 底部分隔线 + 品牌句 + 站点地址
  const footerY = CARD_HEIGHT - 128;
  ctx.strokeStyle = "rgba(148, 163, 184, 0.18)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(padding, footerY);
  ctx.lineTo(CARD_WIDTH - padding, footerY);
  ctx.stroke();

  ctx.fillStyle = CARD_COLORS.sub;
  ctx.font = "600 30px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillText("一句话，生成你的流程图", padding, footerY + 28);

  const site = typeof window !== "undefined" ? window.location.origin : "";
  ctx.fillStyle = CARD_COLORS.accent;
  ctx.font = "500 24px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillText(site, padding, footerY + 72);

  // 右下品牌名
  ctx.textAlign = "right";
  ctx.fillStyle = CARD_COLORS.title;
  ctx.font = "700 32px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillText("语图 Yutu", CARD_WIDTH - padding, footerY + 30);
  ctx.textAlign = "left";
}

/** 触发浏览器下载一个 Blob（与 exportImage 同款语义；卡片独立持有避免循环依赖） */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** SVG 字符串 → HTMLImageElement（纯前端光栅化前置步骤，失败reject） */
function svgToImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("分享卡：SVG 图形加载失败"));
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}

/** 分享卡导出入参 */
export interface DiagramCardOptions {
  /** X6 画布（生成结果已应用的图） */
  graph: Graph;
  /** 卡片标题（通常为生成时的提示词或项目名，超长自动折行截断） */
  title: string;
  /** 下载文件名（不含扩展名） */
  filename?: string;
}

/**
 * 导出「图 + 提示词 + 品牌」3:4 分享卡 PNG（魔性传播核心产物）。
 * 流程：画布 → SVG → Image → 合成暗色卡片 → 下载。
 * 任何环节失败向上抛错（调用方统一 notification 提示）。
 */
export async function exportDiagramCard(options: DiagramCardOptions): Promise<void> {
  const { graph, title } = options;
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = CARD_HEIGHT;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("分享卡：Canvas 2D 上下文不可用");

  // 1) 底 + 品牌位
  drawCardBackground(ctx);
  drawCardBrand(ctx, "YUTU · CARD");

  // 2) 标题（提示词折行，最多 5 行）
  const padding = 64;
  const titleMaxWidth = CARD_WIDTH - padding * 2;
  ctx.font = "600 40px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillStyle = CARD_COLORS.title;
  ctx.textBaseline = "top";
  const titleLines = wrapText(ctx, title || "我的流程图", titleMaxWidth, 5);
  let y = 128;
  for (const line of titleLines) {
    ctx.fillText(line, padding, y);
    y += 54;
  }

  // 3) 画布图：SVG → Image，按内容区等比缩放居中
  const { svg } = await renderGraphToSvg(graph);
  const image = await svgToImage(svg);
  const boxX = padding;
  const boxY = Math.max(y + 24, 430);
  const boxW = CARD_WIDTH - padding * 2;
  const boxH = CARD_HEIGHT - 160 - boxY;
  const scale = Math.min(boxW / image.naturalWidth, boxH / image.naturalHeight);
  const drawW = image.naturalWidth * scale;
  const drawH = image.naturalHeight * scale;
  const drawX = boxX + (boxW - drawW) / 2;
  const drawY = boxY + (boxH - drawH) / 2;

  // 内容区描边框（Neon 感）
  ctx.strokeStyle = CARD_COLORS.frame;
  ctx.lineWidth = 2;
  ctx.strokeRect(boxX, boxY, boxW, boxH);
  // 白底垫层：流程图多为白底线条，直接放暗底会看不清
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(boxX + 2, boxY + 2, boxW - 4, boxH - 4);
  ctx.drawImage(image, drawX, drawY, drawW, drawH);

  // 4) 导出下载
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("分享卡：PNG 编码失败");
  const safeName = (options.filename || title || "yutu-card").slice(0, 40).replace(/[\\/:*?"<>|]/g, "-");
  downloadBlob(blob, `${safeName}-语图分享卡.png`);
}
