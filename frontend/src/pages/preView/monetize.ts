/*
 * @Description: 商业化闭环批次 - 会员/订单展示纯函数
 * 收敛「按次解锁 / 会员月卡」两条付费动线共用的展示逻辑：
 * 价格格式化、会员到期描述、支付回跳参数解析、订单类型文案。
 * 全部为纯函数（不触 DOM/网络），便于 __checks__/monetize.check.ts 直测。
 */

/** 订单类型（与后端 PaymentOrderKind 对齐）：unlock = 按次解锁；vip = 会员月卡 */
export type OrderKind = "unlock" | "vip";

/** 订单金额（分）→ 展示价格（¥X.X；990 分 → ¥9.9） */
export function fenToYuan(fen: number): string {
  const safe = Number.isFinite(fen) && fen > 0 ? fen : 0;
  return `¥${(safe / 100).toFixed(1)}`;
}

/** 会员到期时间（ISO）→ 「YYYY-MM-DD 到期」；空值返回空串（调用方按需隐藏） */
export function formatVipExpire(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} 到期`;
}

/**
 * 解析支付回跳页 URL 查询串（/unlock-result?orderId=..&kind=..&projectId=..）。
 * 宽松解析：非法 kind 回落 unlock；字段缺失返回空串（页面据此渲染无效态）。
 * 独立成纯函数：回跳页是支付转化的最后一公里，参数错一口子就不能跳回预览页。
 */
export function parseUnlockResultQuery(
  search: string
): { orderId: string; kind: OrderKind; projectId: string } {
  const params = new URLSearchParams(search || "");
  const kind = params.get("kind") === "vip" ? "vip" : "unlock";
  return {
    orderId: (params.get("orderId") ?? "").trim(),
    kind,
    projectId: (params.get("projectId") ?? "").trim(),
  };
}

/** 订单类型 → 中文文案（回跳页/看板通用） */
export function describeOrderKind(kind: OrderKind): string {
  return kind === "vip" ? "会员月卡" : "单图解锁";
}

/** 邀请码白名单（与后端 invite.ts 同口径）：4-16 位字母数字 */
const INVITE_CODE_RE = /^[A-Za-z0-9]{4,16}$/;

/**
 * 清洗邀请码（分享/注册提交前统一入口）：白名单外返回 null。
 * 独立纯函数：邀请码出现在 URL、localStorage、表单三处，口径必须唯一。
 */
export function sanitizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim();
  return INVITE_CODE_RE.test(code) ? code : null;
}

/** 生成邀请链接：`${origin}/register?ic=<码>`（origin 由调用方取，便于 check 直测） */
export function buildInviteLink(origin: string, code: string): string {
  const clean = sanitizeInviteCode(code);
  const base = (origin || "").replace(/\/+$/, "");
  if (!clean) return "";
  return `${base}/register?ic=${clean}`;
}

/** 续费提醒窗口（天）：剩 ≤N 天进入提醒态（vip-renewal-reminder-batch） */
export const VIP_RENEWAL_WINDOW_DAYS = 3;

/** 会员剩余整天数（ceil，≥1）；空/非法/已过期返回 null */
export function vipDaysLeft(
  iso: string | null | undefined,
  now: Date = new Date()
): number | null {
  if (!iso) return null;
  const time = new Date(iso).getTime();
  if (!Number.isFinite(time)) return null;
  const diff = time - now.getTime();
  if (diff <= 0) return null;
  return Math.max(1, Math.ceil(diff / 86_400_000));
}

/** 续费提醒文案：≤3 天 → 到期警示（配跳转 /pricing）；常态 → 剩余天数；非会员 → null */
export function vipRenewalText(daysLeft: number | null): string | null {
  if (daysLeft == null) return null;
  if (daysLeft <= VIP_RENEWAL_WINDOW_DAYS) {
    return `${daysLeft} 天后到期 · 续费`;
  }
  return `会员剩 ${daysLeft} 天`;
}

/** 营收看板 - 单窗口营收汇总（与后端 RevenueWindow 契约对齐） */
export interface RevenueWindow {
  unlockOrders: number;
  unlockGmvFen: number;
  vipOrders: number;
  vipGmvFen: number;
}

/** 窗口 GMV（分）→ 元（保留两位；看板卡片展示用） */
export function windowGmvYuan(win: RevenueWindow | undefined): string {
  if (!win) return "0.00";
  return ((win.unlockGmvFen + win.vipGmvFen) / 100).toFixed(2);
}

/** 日趋势点（与后端 DailyTrendPoint 契约对齐） */
export interface DailyTrendPoint {
  day: string;
  unlockGmvFen: number;
  vipGmvFen: number;
}

/** 日趋势柱状图视图模型：百分比高度 + 展示标签（纯 CSS 柱状图直接消费） */
export interface TrendBarView {
  day: string;
  /** MM-DD 短标签 */
  label: string;
  unlockPct: number;
  vipPct: number;
  totalYuan: string;
  hasRevenue: boolean;
}

/**
 * 日趋势 → 柱状图视图（纯函数）：
 * 高度按「全窗口最大单日总额」归一化（0 有收入也给最小可见高度 2%），
 * 空数据/单点/除零均安全。独立成纯函数便于 check 直测展示口径。
 */
export function buildTrendView(
  points: DailyTrendPoint[] | undefined
): TrendBarView[] {
  const safe = Array.isArray(points) ? points : [];
  const maxTotal = safe.reduce(
    (max, p) => Math.max(max, (p.unlockGmvFen || 0) + (p.vipGmvFen || 0)),
    0
  );
  return safe.map((p) => {
    const unlock = p.unlockGmvFen || 0;
    const vip = p.vipGmvFen || 0;
    const total = unlock + vip;
    const scale = maxTotal > 0 ? 100 / maxTotal : 0;
    const pct = (fen: number) => (total > 0 ? Math.max(2, (fen * scale) as number) : 0);
    return {
      day: p.day,
      label: p.day.length >= 10 ? p.day.slice(5) : p.day,
      unlockPct: pct(unlock),
      vipPct: pct(vip),
      totalYuan: (total / 100).toFixed(2),
      hasRevenue: total > 0,
    };
  });
}
