/*
 * @Description: 代码年报卡导出（Round B · annual-report-batch）
 * 把 AnnualReport 统计绘制成 1080×1440（3:4）暗色 Neon 风 PNG —— 开发者年底的可炫耀截图。
 * 复用分享卡工厂的 drawCardBackground/drawCardBrand/wrapText（同形态视觉语言）；
 * 零 LLM 成本：全部为确定性 Canvas 绘制。
 */

import {
  CARD_WIDTH,
  drawCardBackground,
  drawCardBrand,
  wrapText,
} from "./shareCard";
import type { AnnualReport } from "../pages/annual/server";

/** 触发浏览器下载一个 Blob */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

/** 单个统计块：数值（大字强调）+ 标签（小字） */
function drawStatCell(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  value: string,
  label: string,
): void {
  // 半透明底块 + 描边（与内容区描边同语言）
  ctx.fillStyle = "rgba(30, 41, 66, 0.55)";
  ctx.strokeStyle = "rgba(34, 211, 238, 0.18)";
  ctx.lineWidth = 1;
  const h = 148;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(x, y, w, h, 14) : ctx.rect(x, y, w, h);
  ctx.fill();
  ctx.stroke();
  // 数值
  ctx.fillStyle = "#e2e8f0";
  ctx.font = "700 52px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(value, x + w / 2, y + 58);
  // 标签
  ctx.fillStyle = "#94a3b8";
  ctx.font = "500 24px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillText(label, x + w / 2, y + 110);
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
}

/**
 * 导出年报卡 PNG。
 * 版式：品牌位 → 用户名大字 + 平台/年份 → 2×3 统计宫格 → 语言/最星仓库 → 底部诚实口径注。
 */
export async function exportAnnualCard(report: AnnualReport): Promise<void> {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_WIDTH;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("年报卡：Canvas 2D 上下文不可用");

  drawCardBackground(ctx);
  drawCardBrand(ctx, "YUTU · ANNUAL");

  const padding = 64;
  const sourceName = report.source === "github" ? "GitHub" : "Gitee";

  // 用户名（大字，折行兜底）
  ctx.font = "700 72px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillStyle = "#e2e8f0";
  const nameLines = wrapText(ctx, report.username, CARD_WIDTH - padding * 2, 2);
  let y = 120;
  for (const line of nameLines) {
    ctx.fillText(line, padding, y);
    y += 84;
  }

  // 平台 + 年份副题
  ctx.font = "600 30px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.fillStyle = "#22d3ee";
  ctx.fillText(`${sourceName} · ${report.year} 年度代码报告`, padding, y + 8);
  y += 64;

  // 2×3 统计宫格
  const gridX = padding;
  const gridW = CARD_WIDTH - padding * 2;
  const cellW = (gridW - 24) / 2;
  const cells: Array<[string, string]> = [
    [String(report.repoCount) + (report.repoCountTruncated ? "+" : ""), "公开仓库"],
    [String(report.reposCreatedInYear), "年内新建"],
    [String(report.reposActiveInYear), "年内活跃"],
    [String(report.starsTotal), "累计 Stars"],
    [String(report.starsOfNewRepos), "新仓库 Stars"],
    [String(report.topLanguages.length), "主力语言数"],
  ];
  const gridY = y + 16;
  cells.forEach(([value, label], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    drawStatCell(ctx, gridX + col * (cellW + 24), gridY + row * 164, cellW, value, label);
  });
  y = gridY + 3 * 164 + 28;

  // 语言分布行
  if (report.topLanguages.length > 0) {
    const langText = report.topLanguages.map(([lang, count]) => `${lang} ×${count}`).join("   ");
    ctx.font = "600 28px ui-monospace, SFMono-Regular, Menlo, monospace";
    ctx.fillStyle = "#94a3b8";
    const langLines = wrapText(ctx, langText, gridW, 2);
    for (const line of langLines) {
      ctx.fillText(line, padding, y);
      y += 40;
    }
    y += 8;
  }

  // 最星仓库
  if (report.topRepo) {
    ctx.font = "600 30px system-ui, -apple-system, PingFang SC, sans-serif";
    ctx.fillStyle = "#e2e8f0";
    ctx.fillText(`★ 最受欢迎：${report.topRepo.name}（${report.topRepo.stars} Stars）`, padding, y);
    y += 46;
  }
  if (report.lastPushedRepo) {
    ctx.font = "500 26px system-ui, -apple-system, PingFang SC, sans-serif";
    ctx.fillStyle = "#94a3b8";
    const lastLines = wrapText(ctx, `最近活跃仓库：${report.lastPushedRepo}`, gridW, 1);
    ctx.fillText(lastLines[0] ?? "", padding, y);
  }

  // 诚实口径注（紧贴品牌分隔线上方）
  ctx.font = "500 22px system-ui, -apple-system, PingFang SC, sans-serif";
  ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
  ctx.fillText("* 基于公开仓库数据统计（单次最多 100 个仓库）", padding, 1440 - 156);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("年报卡：PNG 编码失败");
  downloadBlob(blob, `${report.username}-${report.year}-语图代码年报.png`);
}
