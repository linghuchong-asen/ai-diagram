/*
 * @Description: 支付回跳页（商业化闭环批次）—— 路由 /unlock-result（公开页）
 * 背景：支付网关回调此前指向裸 /unlock-result，但路由表未注册该页面，
 *      用户付完钱落地 404 —— 付费转化的最后一公里断裂。
 * 动线：支付网关完成 → 浏览器回跳本页（携带 orderId/kind/projectId）→
 *      轮询查单 → paid 则提示成功并跳回预览页（unlock 单）或首页（vip 单）。
 * 边界：页面自身无鉴权也能打开，但查单接口需 JWT，未登录用户只会看到
 *      「未检测到支付」兜底文案，不泄露订单信息。
 */

import { Button, Result, Spin } from "antd";
import { CheckCircleOutlined } from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { getUnlockOrder, getVipOrder } from "../preView/billing";
import { describeOrderKind, parseUnlockResultQuery } from "../preView/monetize";
import BrandTitle from "../legal/brand";

/** 轮询节奏：3 秒 × 20 次（回跳页是用户主动等待场景，比弹窗轮询更有耐心） */
const POLL_INTERVAL_MS = 3000;
const POLL_MAX_ATTEMPTS = 20;

type Phase = "polling" | "paid" | "timeout" | "invalid";

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export const UnlockResultPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { orderId, kind, projectId } = parseUnlockResultQuery(
    `?${searchParams.toString()}`
  );
  const [phase, setPhase] = useState<Phase>(orderId ? "polling" : "invalid");
  /** 会话序号：卸载/重试时自增，使旧轮询失效 */
  const sessionRef = useRef(0);

  useEffect(() => {
    if (!orderId) {
      setPhase("invalid");
      return;
    }
    const session = ++sessionRef.current;
    setPhase("polling");
    (async () => {
      for (let attempt = 0; attempt < POLL_MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(POLL_INTERVAL_MS);
        if (sessionRef.current !== session) return;
        try {
          const order =
            kind === "vip" ? await getVipOrder(orderId) : await getUnlockOrder(orderId);
          if (sessionRef.current !== session) return;
          if (order.status === "paid") {
            setPhase("paid");
            return;
          }
        } catch {
          // 单次查询失败（未登录/网络抖动）继续轮询，超时后走兜底文案
        }
      }
      if (sessionRef.current === session) setPhase("timeout");
    })();
    return () => {
      sessionRef.current++;
    };
  }, [orderId, kind]);

  /** 支付完成后的落点：unlock 单回预览页继续导出；vip 单回首页继续创作 */
  const gotoNext = () => {
    if (kind === "unlock" && projectId) {
      navigate(`/preview/${projectId}`);
    } else {
      navigate("/");
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
        {phase === "polling" && (
          <div style={{ padding: "24px 0" }}>
            <Spin />
            <div style={{ marginTop: 12, fontSize: 13, color: "var(--yt-text-secondary)" }}>
              正在确认{describeOrderKind(kind)}支付结果…
            </div>
            <div style={{ marginTop: 4, fontSize: 12, color: "var(--yt-text-muted)" }}>
              支付完成后会自动跳转，请不要关闭页面
            </div>
          </div>
        )}
        {phase === "paid" && (
          <Result
            status="success"
            title={kind === "vip" ? "会员开通成功" : "解锁成功"}
            subTitle={
              kind === "vip"
                ? "会员期内全站导出无水印，每日可生成 30 次。"
                : "本项目导出与分享已去水印，一次解锁永久有效。"
            }
            extra={
              <Button type="primary" className="yt-btn-primary" icon={<CheckCircleOutlined />} onClick={gotoNext}>
                {kind === "unlock" && projectId ? "去导出我的图" : "回首页"}
              </Button>
            }
          />
        )}
        {phase === "timeout" && (
          <Result
            status="warning"
            title="未检测到支付"
            subTitle="若已完成支付，权益会在通道回调后自动生效，稍后刷新即可；也可回到原页面重新发起。"
            extra={
              <Button onClick={gotoNext}>{kind === "unlock" && projectId ? "回到预览页" : "回首页"}</Button>
            }
          />
        )}
        {phase === "invalid" && (
          <Result
            status="error"
            title="链接无效"
            subTitle="缺少订单信息，请从支付完成页重新进入，或回到原页面查看状态。"
            extra={<Button onClick={() => navigate("/")}>回首页</Button>}
          />
        )}
      </div>
    </div>
  );
};
