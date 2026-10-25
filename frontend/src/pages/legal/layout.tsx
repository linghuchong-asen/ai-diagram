/*
 * @Description: 法务页面（用户服务协议/隐私政策）共用布局 —— Neon Dark 暗色适配
 */
import { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Typography } from "antd";

interface LegalLayoutProps {
  /** 文档标题 */
  title: string;
  /** 更新日期 */
  updatedAt: string;
  children: ReactNode;
}

/** 可滚动文档页：品牌小标题 + 文档标题 + 更新日期 + 正文条款 + 返回登录 */
const LegalLayout = ({ title, updatedAt, children }: LegalLayoutProps) => (
  <div style={{ position: "relative", minHeight: "100vh", padding: "32px 16px" }}>
    <div className="yt-atmo" />
    <div
      className="yt-glass"
      style={{
        position: "relative",
        zIndex: 1,
        maxWidth: 720,
        margin: "0 auto",
        padding: "32px 36px 24px",
      }}
    >
      {/* 顶部品牌小标题 */}
      <div className="yt-mono" style={{ fontSize: 10, color: "var(--yt-text-muted)", textAlign: "center", letterSpacing: "0.24em" }}>
        YUTU · 语图
      </div>
      {/* 文档标题与更新日期 */}
      <Typography.Title level={3} style={{ textAlign: "center", marginTop: 12, marginBottom: 4 }}>
        {title}
      </Typography.Title>
      <div className="yt-mono" style={{ fontSize: 12, color: "var(--yt-text-muted)", textAlign: "center", marginBottom: 24 }}>
        UPDATED {updatedAt}
      </div>
      {/* 正文条款 */}
      {children}
      {/* 底部返回登录 */}
      <div
        style={{
          textAlign: "center",
          marginTop: 24,
          paddingTop: 16,
          borderTop: "1px solid var(--yt-border)",
        }}
      >
        <Link to="/login">返回登录</Link>
      </div>
    </div>
  </div>
);

export default LegalLayout;
