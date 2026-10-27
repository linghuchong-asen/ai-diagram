/*
 * @Description: 会员到期横幅（vip-renewal-reminder-batch 扩展）—— 已登录首页顶部续费触点
 * 触达面：AI 浮窗（配额栏 chip）覆盖「用的时候」，本横幅覆盖「回访第一眼」——双触点闭环。
 * 展示条件（与后端 getVipStatus 口径一致）：
 *   - 在期且剩 1 天 → 「会员明天到期」；
 *   - 已过期 ≤7 天 → 「额度已回落」唤醒（超 7 天的流失用户不打扰）；
 *   - 非会员/在期 >1 天/从未开通 → 不渲染。数据旁路拉取，失败静默隐藏。
 */

import { Button } from "antd";
import { CrownOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { getVipStatus } from "../preView/billing";
import { vipDaysLeft } from "../preView/monetize";

/** 横幅状态（monetize.ts 纯函数 vipBannerKind 的消费形态） */
type BannerKind = "none" | "expiring" | "expired";

interface VipStatusLite {
  vip: boolean;
  vipExpireTime: string | null;
  daysLeft?: number | null;
  expiredDays?: number | null;
}

export const VipExpiryBanner = () => {
  const navigate = useNavigate();
  const [kind, setKind] = useState<BannerKind>("none");
  const [days, setDays] = useState<number>(0);

  useEffect(() => {
    getVipStatus()
      .then((status: VipStatusLite) => {
        if (status?.vip) {
          // 在期：仅剩 1 天才上全站横幅（>1 天由浮窗 chip 承接，避免过度打扰）
          const left = status.daysLeft ?? vipDaysLeft(status.vipExpireTime);
          if (left === 1) {
            setKind("expiring");
            setDays(1);
          }
          return;
        }
        // 已过期：近期（≤7 天）唤醒——额度已回落是具体痛点
        const overdue = status?.expiredDays ?? null;
        if (overdue != null && overdue >= 1 && overdue <= 7) {
          setKind("expired");
          setDays(overdue);
        }
      })
      .catch(() => undefined); // 旁路：失败静默隐藏
  }, []);

  if (kind === "none") return null;

  const expiring = kind === "expiring";
  return (
    <div
      className="yt-glass-border"
      style={{
        position: "relative",
        zIndex: 1,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        marginBottom: 16,
        border: "1px solid var(--yt-accent)",
      }}
    >
      <CrownOutlined style={{ color: "var(--yt-accent)", fontSize: 18, flexShrink: 0 }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--yt-text-primary)" }}>
          {expiring ? "会员明天到期" : `会员已到期 ${days} 天`}
        </div>
        <div style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>
          {expiring
            ? "续费自动顺延 30 天，不丢剩余天数；每日 30 次生成与全站免水印不间断。"
            : "生成额度已回落至每日 3 次；续费立即恢复每日 30 次与全站免水印。"}
        </div>
      </div>
      <Button
        type="primary"
        className="yt-btn-primary"
        icon={<CrownOutlined />}
        onClick={() => navigate("/pricing")}
      >
        {expiring ? "立即续费" : "恢复会员权益"}
      </Button>
    </div>
  );
};
