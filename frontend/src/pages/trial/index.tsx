/*
 * @Description: 免登录试用页（增长方案核心落地页）
 * 未登录：AI 浮窗走试用链路（POST /ai/trial/chat，匿名 trialId，附注册引导转化）；
 * 已登录：即普通生成入口（浮窗走 /ai/chat 正常链路，projectId 为空时不携带）。
 * 布局：yt-atmo 背景 + 玻璃顶栏（品牌 + FREE TRIAL 标签 + 注册 CTA）+ 只读 X6 画布。
 */

import { RocketOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { useMemo } from "react";
import { Link, useSearchParams } from "react-router-dom";
import styled from "@emotion/styled";
import { isTokenValid } from "../../router/private_router";
import { useGraph } from "../../utils/hooks/useGraph";
import AiFloatWindow from "../ai/ai_float_window";
import { BrandLogoSmall } from "../legal/brand";

export const TrialPage = () => {
  const [searchParams] = useSearchParams();
  /** 落地页带来的首发提示词（非空时浮窗自动发送一次） */
  const initialPrompt = (searchParams.get("q") ?? "").trim();

  const token = localStorage.getItem("Authorization");
  const loggedIn = useMemo(() => (token ? isTokenValid(token) : false), [token]);

  // 只读预览画布：与 share/preView 页同一套 isPreview 配置（可平移缩放，不可编辑）
  const graph = useGraph({ id: "trial-canvas", callback: () => {}, isPreview: true });

  return (
    <PageShell>
      <div className="yt-atmo" />

      {/* 顶部小栏：品牌 + FREE TRIAL 标签 + 注册转化 CTA（已登录则显示额度说明） */}
      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          FREE TRIAL
        </span>
        <span style={{ flex: 1 }} />
        {loggedIn ? (
          <span
            className="yt-mono"
            style={{ fontSize: 10, color: "var(--yt-text-muted)", letterSpacing: "0.12em" }}
          >
            已登录 · 每日 3 次免费生成
          </span>
        ) : (
          <Link to="/register">
            <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
              注册解锁更多
            </Button>
          </Link>
        )}
      </TopBar>

      {/* 画布区：生成结果先预览、「应用到画布」后落图（只读，注册继承后在编辑器继续编辑） */}
      <CanvasArea>
        <div id="trial-canvas" style={{ width: "100%", height: "100%" }} />
      </CanvasArea>

      {/* AI 浮窗：未登录走试用链路；initialPrompt 非空时自动首发 */}
      <AiFloatWindow graph={graph} trialMode={!loggedIn} initialPrompt={initialPrompt} />
    </PageShell>
  );
};

/** 页面骨架：全屏纵向布局（顶栏 + 画布自适应填充），浮窗 fixed 悬浮其上 */
const PageShell = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
  background: #0a0f1e;
`;

/** 顶部玻璃小栏（与 share/preView 顶栏同构） */
const TopBar = styled.header`
  position: relative;
  z-index: 300;
  flex: 0 0 52px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 16px;
  background: rgba(10, 15, 30, 0.85);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border-bottom: 1px solid rgba(34, 211, 238, 0.18);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  @media (max-width: 768px) {
    padding: 0 10px;
    gap: 8px;
  }
`;

/** 画布区：flex 填充剩余高度，容器宽度 100% 保证画布可随窗口缩放 */
const CanvasArea = styled.div`
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
`;
