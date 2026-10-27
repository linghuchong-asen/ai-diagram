/*
 * @Description: 邀请活动页（邀请裂变批次）—— 路由 /invite（登录态，PrivateRoute）
 * 「推广营销」的用户侧落地：把增长一页纸里「发链接」升级为「发我的邀请链接」。
 *   - 专属邀请码 + 一键复制链接（${origin}/register?ic=<码>）；
 *   - 规则说准确（不承诺、不夸大）：邀请 1 人注册 +1 天会员，日上限 +3 天；好友得 +2 次生成；
 *   - 我的战果：已邀请人数 / 会员到期日（会员权益与裂变互相放大）。
 * 未登录经 PrivateRoute 跳登录并携带 redirect 回流。
 */

import { Button, Card, Spin, Typography, notification } from "antd";
import { CopyOutlined, CrownOutlined, GiftOutlined } from "@ant-design/icons";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";
import { copyText } from "../../utils/clipboard";
import { buildInviteLink, formatVipExpire } from "../preView/monetize";

/** /billing/invite/me 响应（与后端 getInviteHome 契约对齐） */
interface InviteHomeView {
  inviteCode: string | null;
  invitedCount: number;
  /** 阶梯里程碑进度（留存与裂变加强批次）：累计邀请人数跨档一次性加送会员天数 */
  milestones?: Array<{ count: number; days: number; claimed: boolean }>;
  vip: boolean;
  vipExpireTime: string | null;
}

/** 我的社区作品（投稿者数据面板，与后端 listMyCommunity 契约对齐） */
interface MyCommunityItem {
  id: string;
  title: string;
  status: "pending" | "approved" | "rejected";
  viewCount: number;
  copyCount: number;
  shareToken: string;
}

/** 审核状态 → 展示文案与颜色 */
const STATUS_TEXT: Record<MyCommunityItem["status"], { text: string; color: string }> = {
  pending: { text: "审核中", color: "var(--yt-text-muted)" },
  approved: { text: "已上架", color: "var(--yt-accent)" },
  rejected: { text: "已驳回", color: "#ff6b6b" },
};

/** 活动规则（与 growth 一页纸「获客引擎 D」口径一致，改动需同步） */
const INVITE_RULES = [
  "把你的专属链接发给同学/同事，TA 注册即计数",
  "每成功邀请 1 人：你的会员有效期 +1 天（未开通 = 获得当天起 1 天体验会员）",
  "邀请奖励每日最多 +3 天，防小号刷奖励",
  "累计邀请 3 人额外 +3 天会员、累计 10 人额外 +7 天会员（自动发放，每档一次）",
  "被邀请的好友：注册当日额外 +2 次生成（欢迎礼）",
];

export const InvitePage = () => {
  const [home, setHome] = useState<InviteHomeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  /** 复制中（按钮 loading） */
  const [copying, setCopying] = useState(false);
  /** 我的社区作品（投稿者数据面板；旁路查询，失败隐藏分区） */
  const [myTemplates, setMyTemplates] = useState<MyCommunityItem[] | null>(null);

  useEffect(() => {
    // 旁路请求：失败给重试态，不阻塞页面骨架
    fetch("/api/billing/invite/me", {
      headers: { Authorization: localStorage.getItem("Authorization") ?? "" },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => setHome((body?.data ?? null) as InviteHomeView | null))
      .catch(() => setError(true))
      .finally(() => setLoading(false));
    // 我的社区作品（投稿者数据面板）：失败静默隐藏分区
    fetch("/api/template/community/mine", {
      headers: { Authorization: localStorage.getItem("Authorization") ?? "" },
    })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
      .then((body) => setMyTemplates(Array.isArray(body?.data) ? body.data : []))
      .catch(() => setMyTemplates(null));
  }, []);

  /** 专属邀请链接（origin 取当前站点，inviteCode 未生成时为空串） */
  const inviteLink =
    home?.inviteCode
      ? buildInviteLink(window.location.origin, home.inviteCode)
      : "";

  const handleCopy = async () => {
    if (!inviteLink || copying) return;
    setCopying(true);
    const copied = await copyText(inviteLink);
    setCopying(false);
    notification[copied ? "success" : "error"]({
      message: copied ? "邀请链接已复制" : "复制失败，请手动复制",
      description: copied ? "发到群里，好友注册你就 +1 天会员" : inviteLink,
    });
  };

  return (
    <div style={{ position: "relative", minHeight: "100vh", padding: "20px 16px 48px", overflow: "hidden" }}>
      <div className="yt-atmo" />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 640, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 24 }}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <BrandLogoSmall />
          </Link>
          <Link to="/pricing" className="yt-mono" style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>
            查看价格 →
          </Link>
        </div>

        <Typography.Title level={3} style={{ color: "var(--yt-text-primary)", marginTop: 8, textAlign: "center" }}>
          邀请好友，双方都得
        </Typography.Title>
        <Typography.Paragraph
          type="secondary"
          style={{ fontSize: 13, textAlign: "center", marginBottom: 20 }}
        >
          你得会员天数，好友得生成额度 —— 把好用的工具分享给需要的人。
        </Typography.Paragraph>

        {loading && (
          <div style={{ display: "grid", placeItems: "center", padding: 48 }}>
            <Spin tip="正在获取你的专属邀请码…" />
          </div>
        )}
        {error && !loading && (
          <Card>
            <Typography.Text type="secondary">
              邀请数据加载失败，请刷新重试；若持续失败请重新登录。
            </Typography.Text>
          </Card>
        )}

        {home && !loading && (
          <>
            {/* 专属邀请码卡片 */}
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ textAlign: "center", padding: "6px 0" }}>
                <div className="yt-mono yt-preview-tag" style={{ marginBottom: 10 }}>
                  YOUR INVITE CODE
                </div>
                <div
                  className="yt-mono"
                  style={{
                    fontSize: 30,
                    letterSpacing: "0.3em",
                    color: "var(--yt-accent)",
                    fontWeight: 700,
                    userSelect: "all",
                  }}
                >
                  {home.inviteCode ?? "—"}
                </div>
                {inviteLink && (
                  <div
                    className="yt-mono"
                    style={{
                      marginTop: 10,
                      fontSize: 11,
                      color: "var(--yt-text-muted)",
                      wordBreak: "break-all",
                      userSelect: "all",
                    }}
                  >
                    {inviteLink}
                  </div>
                )}
                <Button
                  type="primary"
                  className="yt-btn-primary"
                  icon={<CopyOutlined />}
                  style={{ marginTop: 14 }}
                  loading={copying}
                  disabled={!inviteLink}
                  onClick={handleCopy}
                >
                  一键复制邀请链接
                </Button>
              </div>
            </Card>

            {/* 我的战果 */}
            <Card size="small" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", gap: 24, justifyContent: "center", textAlign: "center" }}>
                <div>
                  <div style={{ fontSize: 24, fontWeight: 700, color: "var(--yt-text-primary)" }}>
                    {home.invitedCount}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>已邀请注册</div>
                </div>
                <div>
                  <div
                    className="yt-mono"
                    style={{
                      fontSize: 16,
                      fontWeight: 600,
                      color: "var(--yt-text-primary)",
                      paddingTop: 6,
                    }}
                  >
                    {home.vip ? formatVipExpire(home.vipExpireTime) : "未开通"}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>
                    {home.vip ? "会员有效期" : "会员状态"}
                  </div>
                </div>
              </div>
            </Card>

            {/* 我的社区作品（投稿者数据面板）：审核状态 + 热度反馈（激励闭环的可视化） */}
            {myTemplates && myTemplates.length > 0 && (
              <Card size="small" style={{ marginBottom: 16 }} title={<span style={{ fontSize: 13 }}><GiftOutlined /> 我的社区作品</span>}>
                {myTemplates.map((tpl) => {
                  const st = STATUS_TEXT[tpl.status] ?? STATUS_TEXT.pending;
                  return (
                    <div
                      key={tpl.id}
                      style={{ display: "flex", alignItems: "center", gap: 10, lineHeight: 2.2 }}
                    >
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13,
                          color: "var(--yt-text-primary)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {tpl.title}
                      </span>
                      <span className="yt-mono" style={{ fontSize: 11, color: "var(--yt-text-muted)" }}>
                        {tpl.viewCount} 查看 · {tpl.copyCount} 复制
                      </span>
                      <span className="yt-mono" style={{ fontSize: 11, color: st.color, minWidth: 48, textAlign: "right" }}>
                        {st.text}
                      </span>
                    </div>
                  );
                })}
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--yt-text-muted)" }}>
                  作品被复制跨档会自动发放会员天数（5 次 +1 天 / 20 次 +3 天）。
                </div>
              </Card>
            )}

            {/* 阶梯邀请里程碑（留存与裂变加强批次）：跨档自动发放，进度可视 */}
            {home.milestones && home.milestones.length > 0 && (
              <Card size="small" style={{ marginBottom: 16 }} title={<span style={{ fontSize: 13 }}><CrownOutlined /> 邀请里程碑</span>}>
                {home.milestones.map((m) => {
                  const progress = Math.min(home.invitedCount, m.count);
                  return (
                    <div key={m.count} style={{ display: "flex", alignItems: "center", gap: 10, lineHeight: 2.2 }}>
                      <span className="yt-mono" style={{ fontSize: 12, color: "var(--yt-text-primary)", minWidth: 96 }}>
                        累计 {m.count} 人
                      </span>
                      <span style={{ fontSize: 12, color: "var(--yt-text-secondary)", minWidth: 72 }}>
                        +{m.days} 天会员
                      </span>
                      <div
                        style={{
                          flex: 1,
                          height: 6,
                          borderRadius: 3,
                          background: "rgba(255,255,255,0.08)",
                          overflow: "hidden",
                        }}
                      >
                        <div
                          style={{
                            width: `${(progress / m.count) * 100}%`,
                            height: "100%",
                            background: "var(--yt-accent)",
                          }}
                        />
                      </div>
                      <span
                        className="yt-mono"
                        style={{
                          fontSize: 11,
                          minWidth: 56,
                          textAlign: "right",
                          color: m.claimed ? "var(--yt-accent)" : "var(--yt-text-muted)",
                        }}
                      >
                        {m.claimed ? "已发放" : `${progress}/${m.count}`}
                      </span>
                    </div>
                  );
                })}
              </Card>
            )}

            {/* 活动规则（口径与后端 invite.ts 一致） */}
            <Card size="small" title={<span style={{ fontSize: 13 }}><GiftOutlined /> 活动规则</span>}>
              {INVITE_RULES.map((rule, idx) => (
                <div key={rule} style={{ fontSize: 12.5, color: "var(--yt-text-secondary)", lineHeight: 2 }}>
                  {idx + 1}. {rule}
                </div>
              ))}
              <div style={{ marginTop: 10, fontSize: 12 }}>
                <Link to="/pricing" style={{ color: "var(--yt-accent)" }}>
                  <CrownOutlined /> 想要更多额度？看看会员月卡 →
                </Link>
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
};
