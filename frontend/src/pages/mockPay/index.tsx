/*
 * @Description: 模拟支付收银台（商业化闭环批次）—— 路由 /mock-pay（公开页，仅沙箱）
 * 只在 PAY_CHANNEL=mock 的沙箱环境可达（该环境下单返回的 payUrl 指向本页）：
 * 展示订单号与金额说明，「模拟支付成功」按钮把下单时签发的 orderId+sign
 * POST 回 /billing/notify/mock，后端 HMAC 验签后按与真实通道完全相同的语义放行。
 * 安全边界：sign 由服务端 HMAC 签发，伪造 sign 过不了验签；生产（默认
 * PAY_CHANNEL=xunhupay）不会生成指向本页的 payUrl，回调端点也一律拒绝。
 */

import { Button, Result, Spin } from "antd";
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { http } from "../../utils/http";
import { parseUnlockResultQuery } from "../preView/monetize";
import BrandTitle from "../legal/brand";

export const MockPayPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { orderId } = parseUnlockResultQuery(`?${searchParams.toString()}`);
  /** 模拟支付进行中/结果态 */
  const [paying, setPaying] = useState(false);
  const [paid, setPaid] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  /**
   * 模拟支付成功：POST /billing/notify/mock（body: orderId+sign）。
   * 后端验签通过 → 与真实通道同一放行逻辑（解锁/会员生效），前端提示后可关闭页面。
   */
  const handlePay = async () => {
    if (!orderId || paying) return;
    setPaying(true);
    setFailed(null);
    try {
      await http<string>("/billing/notify/mock", {
        method: "post",
        params: {
          orderId,
          sign: searchParams.get("sign") ?? "",
        },
      });
      setPaid(true);
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "模拟支付失败，请重试");
    } finally {
      setPaying(false);
    }
  };

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        padding: "24px 16px",
        overflow: "hidden",
      }}
    >
      <div className="yt-atmo" />
      <div
        className="yt-glass-border"
        style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 460, padding: "40px 36px 30px", textAlign: "center" }}
      >
        <BrandTitle />
        {paid ? (
          <Result
            status="success"
            title="模拟支付完成"
            subTitle="权益已按真实支付同一链路生效，可回到原页面查看（解锁/会员即时生效）。"
            extra={<Button onClick={() => navigate("/")}>回首页</Button>}
          />
        ) : (
          <div style={{ padding: "20px 0 8px" }}>
            <div className="yt-mono yt-preview-tag" style={{ marginBottom: 12 }}>
              SANDBOX CHECKOUT
            </div>
            <div style={{ fontSize: 14, color: "var(--yt-text-primary)", marginBottom: 6 }}>
              模拟收银台（沙箱演示环境）
            </div>
            <div style={{ fontSize: 12, color: "var(--yt-text-secondary)", lineHeight: 1.9 }}>
              订单号：<span className="yt-mono">{orderId || "（未提供）"}</span>
              <br />
              点击下方按钮即模拟「支付成功」回调，用于演示与联调完整收款闭环；
              生产环境走真实支付网关，本页不可达。
            </div>
            {failed && (
              <div style={{ marginTop: 10, fontSize: 12, color: "#ff6b6b" }}>{failed}</div>
            )}
            <Button
              type="primary"
              className="yt-btn-primary"
              style={{ marginTop: 18 }}
              loading={paying}
              disabled={!orderId}
              onClick={handlePay}
            >
              模拟支付成功
            </Button>
            {!orderId && (
              <div style={{ marginTop: 10, fontSize: 12, color: "var(--yt-text-muted)" }}>
                <Spin size="small" /> 正在解析订单参数…
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
