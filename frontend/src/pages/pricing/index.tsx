/*
 * @Description: 价格页（付费转化增强批次）—— 路由 /pricing（公开页）
 * 盈利方式的「对外橱窗」：免费 / 单图解锁 / 会员月卡三卡对比，访客不登录也能
 * 看到完整价格锚点。会员卡「立即开通」按登录态分流：
 *   未登录 → 跳登录（带 redirect 回本页，登录后回来再点一次即下单）；
 *   已登录 → 直接创建会员订单，走与预览页一致的支付/沙箱分流 + 轮询闭环。
 * 单图解锁不设在线下单入口（按项目计费，落点在预览页），卡内引导先生成图。
 */

import { Button, Modal, Spin, notification } from "antd";
import { CheckOutlined, CrownOutlined, RocketOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";
import { isTokenValid } from "../../router/private_router";
import { getVipOrder, getVipStatus, useCreateVipOrder } from "../preView/billing";
import { fenToYuan, formatVipExpire, vipDaysLeft, vipRenewalText } from "../preView/monetize";

/** 轮询参数（与预览页解锁动线同节奏） */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 10;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 会员下单弹窗阶段：creating 下单中 / pay 支付+轮询 / sponsor 赞助引导 / timeout / paid 成功 */
type VipPhase = "creating" | "pay" | "sponsor" | "timeout" | "paid";

/** 三卡静态文案（价格金额由服务端结算，页面文案只做锚点展示） */
const PLAN_FEATURES = {
  free: ["每日 3 次生成", "分享项目再 +1（日上限 +3）", "导出 PNG/SVG/分享卡（带水印）", "五形态产物：流程图/导图/表格/清单/时间线"],
  single: ["一次解锁，永久无水印", "高清 PNG / SVG / Mermaid 代码", "分享页同步去水印", "首单特惠 ¥0.9"],
  vip: ["每日 30 次生成", "全站项目免水印（新项目自动生效）", "续费到期自动顺延 30 天", "优先体验新形态与模板"],
} as const;

export const PricingPage = () => {
  const navigate = useNavigate();
  /** 登录态：决定「立即开通」直接下单还是先去登录（带 redirect 回本页） */
  const loggedIn = useMemo(() => {
    const stored = localStorage.getItem("Authorization");
    return stored ? isTokenValid(stored) : false;
  }, []);

  /** 会员状态（已登录才有意义；旁路查询，失败按非会员处理） */
  const [vipExpire, setVipExpire] = useState<string | null>(null);
  /** 在期剩余天数（续费提醒口径与后端一致：服务端 daysLeft） */
  const [vipDaysLeftState, setVipDaysLeftState] = useState<number | null>(null);
  const [vipChecked, setVipChecked] = useState(false);
  useEffect(() => {
    if (!loggedIn) {
      setVipChecked(true);
      return;
    }
    getVipStatus()
      .then((status) => {
        setVipExpire(status.vip ? status.vipExpireTime : null);
        setVipDaysLeftState(status.vip ? status.daysLeft ?? null : null);
      })
      .catch(() => undefined)
      .finally(() => setVipChecked(true));
  }, [loggedIn]);

  /* ===== 会员下单动线（与预览页解锁动线同构：下单 → 支付/赞助分流 → 轮询 → 成功） ===== */
  const { mutateAsync: createVipOrder, isLoading: creatingVip } = useCreateVipOrder();
  const [vipOpen, setVipOpen] = useState(false);
  const [vipPhase, setVipPhase] = useState<VipPhase>("creating");
  const [vipPrice, setVipPrice] = useState<string | null>(null);
  const [firstVipOrder, setFirstVipOrder] = useState(false);
  const sessionRef = useRef(0);

  const handleBuyVip = async () => {
    const session = ++sessionRef.current;
    setVipOpen(true);
    setVipPhase("creating");
    setVipPrice(null);
    setFirstVipOrder(false);
    try {
      const result = (await createVipOrder())?.data;
      if (!result || sessionRef.current !== session) return;
      if (result.firstOrder === true) setFirstVipOrder(true);
      if (result.mode === "sponsor") {
        setVipPhase("sponsor");
        if (result.orderId) {
          getVipOrder(result.orderId)
            .then((order) => {
              if (sessionRef.current === session) setVipPrice(fenToYuan(order.amount));
            })
            .catch(() => undefined);
        }
        return;
      }
      setVipPhase("pay");
      if (result.payUrl) window.open(result.payUrl);
      // 轮询支付结果（ paid → 成功态 + 刷新会员徽标）
      if (result.orderId) {
        for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
          if (attempt > 0) await sleep(POLL_INTERVAL_MS);
          if (sessionRef.current !== session) return;
          try {
            const order = await getVipOrder(result.orderId);
            if (sessionRef.current !== session) return;
            setVipPrice(fenToYuan(order.amount));
            if (order.status === "paid") {
              setVipPhase("paid");
              getVipStatus()
                .then((status) => setVipExpire(status.vip ? status.vipExpireTime : null))
                .catch(() => undefined);
              notification.success({ message: "会员开通成功，全站导出无水印" });
              return;
            }
          } catch {
            // 单次查询失败不中断轮询
          }
        }
        if (sessionRef.current === session) setVipPhase("timeout");
      }
    } catch {
      // 下单失败已由 useCreateVipOrder 统一提示
      if (sessionRef.current === session) setVipOpen(false);
    }
  };

  /** 会员卡 CTA 文案：在期 → 续费；未开通 → 立即开通 */
  const vipCtaText = vipExpire ? "续费会员月卡" : "立即开通会员";

  return (
    <div style={{ position: "relative", minHeight: "100vh", padding: "20px 16px 48px", overflow: "hidden" }}>
      <div className="yt-atmo" />
      <div style={{ position: "relative", zIndex: 1, maxWidth: 960, margin: "0 auto" }}>
        {/* 顶栏 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
          <Link to="/" style={{ textDecoration: "none" }}>
            <BrandLogoSmall />
          </Link>
          <Link to="/" className="yt-mono" style={{ fontSize: 12, color: "var(--yt-text-secondary)" }}>
            返回首页 →
          </Link>
        </div>

        <h1 style={{ color: "var(--yt-text-primary)", fontSize: 26, margin: "0 0 8px", textAlign: "center" }}>
          选择你的方案
        </h1>
        <p style={{ color: "var(--yt-text-secondary)", fontSize: 13, textAlign: "center", margin: "0 0 28px" }}>
          先免费，满意再付费；金额一律由服务端结算，一次付费长期有效。
        </p>

        {/* 三卡对比 */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, justifyContent: "center" }}>
          {/* 免费 */}
          <div className="yt-glass-border" style={{ flex: "1 1 260px", maxWidth: 300, padding: "22px 20px" }}>
            <div className="yt-mono yt-preview-tag">FREE</div>
            <div style={{ color: "var(--yt-text-primary)", fontSize: 26, fontWeight: 700, margin: "10px 0 2px" }}>¥0</div>
            <div style={{ color: "var(--yt-text-muted)", fontSize: 12, marginBottom: 14 }}>免登录即可开始</div>
            {PLAN_FEATURES.free.map((f) => (
              <div key={f} style={{ fontSize: 12.5, color: "var(--yt-text-secondary)", lineHeight: 2 }}>
                <CheckOutlined style={{ color: "var(--yt-accent)", marginRight: 6 }} />
                {f}
              </div>
            ))}
            <Button block style={{ marginTop: 18 }} icon={<RocketOutlined />} onClick={() => navigate("/trial")}>
              免费开始
            </Button>
          </div>

          {/* 单图解锁 */}
          <div className="yt-glass-border" style={{ flex: "1 1 260px", maxWidth: 300, padding: "22px 20px" }}>
            <div className="yt-mono yt-preview-tag">PER DIAGRAM</div>
            <div style={{ color: "var(--yt-text-primary)", fontSize: 26, fontWeight: 700, margin: "10px 0 2px" }}>
              ¥1.9<span style={{ fontSize: 12, fontWeight: 400, color: "var(--yt-text-muted)" }}> /张</span>
            </div>
            <div style={{ color: "var(--yt-text-muted)", fontSize: 12, marginBottom: 14 }}>首单特惠 ¥0.9</div>
            {PLAN_FEATURES.single.map((f) => (
              <div key={f} style={{ fontSize: 12.5, color: "var(--yt-text-secondary)", lineHeight: 2 }}>
                <CheckOutlined style={{ color: "var(--yt-accent)", marginRight: 6 }} />
                {f}
              </div>
            ))}
            <Button block style={{ marginTop: 18 }} onClick={() => navigate("/")}>
              生成一张图去解锁
            </Button>
          </div>

          {/* 会员月卡 */}
          <div
            className="yt-glass-border"
            style={{
              flex: "1 1 260px",
              maxWidth: 300,
              padding: "22px 20px",
              border: "1px solid var(--yt-accent, #22d3ee)",
              position: "relative",
            }}
          >
            <div className="yt-mono yt-preview-tag" style={{ color: "var(--yt-accent)" }}>
              VIP MONTHLY · 最划算
            </div>
            <div style={{ color: "var(--yt-text-primary)", fontSize: 26, fontWeight: 700, margin: "10px 0 2px" }}>
              ¥9.9<span style={{ fontSize: 12, fontWeight: 400, color: "var(--yt-text-muted)" }}> /月</span>
            </div>
            <div style={{ color: "var(--yt-text-muted)", fontSize: 12, marginBottom: 14 }}>
              首月 ¥5.9
              {vipExpire ? ` · ${formatVipExpire(vipExpire)}` : ""}
              {/* 续费提醒（vip-renewal-reminder-batch）：在期显示剩余天数与顺延规则 */}
              {vipDaysLeftState != null
                ? ` · ${vipRenewalText(vipDaysLeftState) ?? ""}（续费自动顺延 30 天，不丢剩余天数）`
                : ""}
            </div>
            {PLAN_FEATURES.vip.map((f) => (
              <div key={f} style={{ fontSize: 12.5, color: "var(--yt-text-secondary)", lineHeight: 2 }}>
                <CheckOutlined style={{ color: "var(--yt-accent)", marginRight: 6 }} />
                {f}
              </div>
            ))}
            {loggedIn ? (
              <Button
                type="primary"
                className="yt-btn-primary"
                block
                icon={<CrownOutlined />}
                style={{ marginTop: 18 }}
                loading={creatingVip || !vipChecked}
                onClick={handleBuyVip}
              >
                {vipCtaText}
              </Button>
            ) : (
              <Link to="/login?redirect=/pricing">
                <Button
                  type="primary"
                  className="yt-btn-primary"
                  block
                  icon={<CrownOutlined />}
                  style={{ marginTop: 18 }}
                >
                  登录后开通会员
                </Button>
              </Link>
            )}
          </div>
        </div>

        <p style={{ color: "var(--yt-text-muted)", fontSize: 12, textAlign: "center", marginTop: 24, lineHeight: 1.9 }}>
          收款通道开放前下单会展示赞助引导，不会误扣款；对公合作与批量采购请联系客服邮箱。
          <br />
          {/* 邀请裂变批次：价格页底部的裂变入口（邀请得会员天数，与付费互相放大） */}
          <Link to="/invite" style={{ color: "var(--yt-accent, #22d3ee)" }}>
            邀请好友注册，你得会员天数、TA 得生成额度 →
          </Link>
        </p>
      </div>

      {/* 会员下单弹窗：与预览页解锁动线同构（pay/sponsor/timeout/paid 四态 + 轮询） */}
      <Modal
        title="开通会员月卡"
        visible={vipOpen}
        onCancel={() => {
          sessionRef.current++;
          setVipOpen(false);
        }}
        footer={
          vipPhase === "creating" || vipPhase === "pay" ? (
            <Button onClick={() => { sessionRef.current++; setVipOpen(false); }}>取消</Button>
          ) : (
            <Button type="primary" className="yt-btn-primary" onClick={() => setVipOpen(false)}>
              {vipPhase === "paid" ? "完成" : "知道了"}
            </Button>
          )
        }
      >
        {vipPhase === "creating" && (
          <div style={{ padding: "18px 0", textAlign: "center" }}>
            <Spin />
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--yt-text-secondary)" }}>正在创建会员订单…</div>
          </div>
        )}
        {vipPhase === "pay" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>已为你打开支付页面，完成支付后自动开通会员（30 天）。</div>
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>{vipPrice ?? "—"}</span>
              {firstVipOrder && (
                <span className="yt-mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--yt-accent)", letterSpacing: "0.12em" }}>
                  首月特惠
                </span>
              )}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spin size="small" />
              正在检测支付结果…
            </div>
          </div>
        )}
        {vipPhase === "sponsor" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>收款通道即将开放，可先联系作者赞助开通会员。</div>
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>{vipPrice ?? "—"}</span>
            </div>
          </div>
        )}
        {vipPhase === "timeout" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>未检测到支付。若已完成支付，会员会在通道回调后自动生效，稍后刷新本页即可。</div>
          </div>
        )}
        {vipPhase === "paid" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div style={{ color: "var(--yt-text-primary)", fontWeight: 600, marginBottom: 6 }}>
              会员开通成功 🎉
            </div>
            <div>全站导出无水印 + 每日 30 次生成已生效{vipExpire ? `（${formatVipExpire(vipExpire)}）` : ""}。</div>
          </div>
        )}
      </Modal>
    </div>
  );
};
