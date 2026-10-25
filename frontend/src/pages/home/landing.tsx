/*
 * @Description: 未登录落地页（增长方案：免登录单次试用入口）
 * 访客在首页即可输入一句话 → 跳转 /trial 免登录生成；顶栏常驻登录/注册入口。
 * 设计语言：Neon Dark（yt-atmo 氛围背景 + 玻璃 hero + 电光青 CTA），与登录页同构。
 */

import {
  DownloadOutlined,
  RocketOutlined,
  ShareAltOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input } from "antd";
import { ReactNode, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";

/** 快捷示例（与 AI 浮窗 PRESET_PROMPTS 同源摘录）：点击填入输入框 */
const QUICK_PROMPTS: Array<{ label: string; text: string }> = [
  { label: "请假审批流程", text: "帮我生成一个员工请假审批流程图：员工提交请假申请，直属主管审批，超过 3 天需要部门总监复核，通过后人事备案。" },
  { label: "电商订单流程", text: "帮我生成一个电商订单处理流程图：用户下单、支付、库存校验、风控审核、发货、物流签收，支持退款分支。" },
  { label: "用户注册登录", text: "帮我生成一个用户注册登录流程图：手机号注册、验证码校验、设置密码、登录，含找回密码分支。" },
];

/** 底部卖点卡（yt-glass-border 玻璃小卡） */
const SELLING_POINTS: Array<{ icon: ReactNode; title: string; desc: string }> = [
  { icon: <ThunderboltOutlined />, title: "AI 语义生成", desc: "一句话描述流程，AI 自动规划节点与连线" },
  { icon: <DownloadOutlined />, title: "免费导出 PNG·SVG", desc: "生成即可导出高清图片，无需安装任何软件" },
  { icon: <ShareAltOutlined />, title: "一键分享", desc: "生成分享链接，好友无需注册即可查看" },
];

export const LandingPage = () => {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  /** 跳转试用页：q 参数由浮窗自动首发（免登录链路） */
  const goTrial = () => {
    if (!trimmed) return;
    navigate(`/trial?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <PageWrap>
      {/* 氛围背景：网格 + 光晕 + 扫描光束 */}
      <div className="yt-atmo" />

      {/* 顶栏：品牌 + 登录/注册小字链接 */}
      <TopBar>
        <BrandLogoSmall />
        <TopLinks>
          <Link to="/login">登录</Link>
          <Link to="/register">注册</Link>
        </TopLinks>
      </TopBar>

      {/* Hero 玻璃主卡：标语 + 大输入框 + 快捷 chips */}
      <HeroPanel className="yt-glass-border">
        <HeroTag className="yt-mono">FREE TRIAL · NO SIGN-UP</HeroTag>
        <HeroTitle>一句话，生成你的流程图</HeroTitle>
        <HeroSubtitle>免登录免费试一次 · 约 30 秒出图 · 注册后每日 3 次</HeroSubtitle>

        <InputRow>
          <Input
            size="large"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={goTrial}
            placeholder="描述一个流程，如：电商订单退款，用户申请→客服审核→原路退回"
          />
          <Button
            type="primary"
            className="yt-btn-primary"
            size="large"
            icon={<RocketOutlined />}
            disabled={!trimmed}
            onClick={goTrial}
          >
            立即免费生成
          </Button>
        </InputRow>

        <ChipRow>
          {QUICK_PROMPTS.map((preset) => (
            <span
              key={preset.label}
              className="yt-chip"
              title={preset.text}
              onClick={() => setText(preset.text)}
            >
              {preset.label}
            </span>
          ))}
        </ChipRow>

        <TemplateLink to="/templates">浏览模板中心 →</TemplateLink>
      </HeroPanel>

      {/* 底部卖点小卡 */}
      <PointsRow>
        {SELLING_POINTS.map((point) => (
          <PointCard key={point.title} className="yt-glass-border">
            <PointIcon>{point.icon}</PointIcon>
            <PointTitle>{point.title}</PointTitle>
            <PointDesc>{point.desc}</PointDesc>
          </PointCard>
        ))}
      </PointsRow>
    </PageWrap>
  );
};

/** 页面外层：内容居中限宽 */
const PageWrap = styled.div`
  position: relative;
  min-height: 100vh;
  padding: 28px 24px 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** 顶栏：左右分布（品牌 + 文字链接） */
const TopBar = styled.header`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 920px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 56px;
  @media (max-width: 768px) {
    margin-bottom: 32px;
  }
`;

/** 顶栏右侧链接组 */
const TopLinks = styled.nav`
  display: flex;
  align-items: center;
  gap: 22px;
  font-size: 13px;
  a {
    color: var(--yt-text-secondary);
    transition: color 0.2s ease;
  }
  a:hover {
    color: var(--yt-accent);
  }
`;

/** Hero 玻璃主卡 */
const HeroPanel = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 920px;
  padding: 52px 48px 40px;
  text-align: center;
  @media (max-width: 768px) {
    padding: 32px 20px 26px;
  }
`;

/** Hero 顶部等宽小标签 */
const HeroTag = styled.div`
  font-size: 10px;
  letter-spacing: 0.28em;
  color: var(--yt-accent);
  opacity: 0.85;
  margin-bottom: 18px;
`;

/** 大标语：品牌渐变 */
const HeroTitle = styled.h1`
  margin: 0 0 14px;
  font-size: 40px;
  font-weight: 700;
  letter-spacing: 0.06em;
  background: linear-gradient(135deg, #22d3ee 10%, #818cf8 90%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  filter: drop-shadow(0 0 22px rgba(34, 211, 238, 0.28));
  @media (max-width: 768px) {
    font-size: 26px;
  }
`;

/** 副标语 */
const HeroSubtitle = styled.div`
  font-size: 14px;
  color: var(--yt-text-secondary);
  letter-spacing: 0.04em;
  margin-bottom: 34px;
  @media (max-width: 768px) {
    font-size: 12px;
    margin-bottom: 24px;
  }
`;

/** 输入行：大输入框 + 主按钮 */
const InputRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: stretch;
  .ant-input {
    background: rgba(30, 41, 66, 0.55);
    border-color: var(--yt-border);
    color: var(--yt-text-primary);
  }
  .ant-input:focus,
  .ant-input-focused {
    border-color: rgba(34, 211, 238, 0.55);
    box-shadow: 0 0 0 2px rgba(34, 211, 238, 0.12);
  }
  @media (max-width: 768px) {
    flex-direction: column;
  }
`;

/** 快捷 chips 行 */
const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 22px;
`;

/** 次入口：模板中心链接 */
const TemplateLink = styled(Link)`
  display: inline-block;
  margin-top: 24px;
  font-size: 13px;
  color: var(--yt-text-muted);
  &:hover {
    color: var(--yt-accent);
  }
`;

/** 卖点卡行：三列等宽 */
const PointsRow = styled.div`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 920px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 18px;
  margin-top: 34px;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
    gap: 12px;
    margin-top: 24px;
  }
`;

/** 单张卖点小卡 */
const PointCard = styled.div`
  padding: 22px 24px;
  border-radius: 14px;
  text-align: left;
  @media (max-width: 768px) {
    padding: 16px 18px;
  }
`;
const PointIcon = styled.div`
  font-size: 20px;
  color: var(--yt-accent);
  margin-bottom: 10px;
`;
const PointTitle = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--yt-text-primary);
  margin-bottom: 6px;
`;
const PointDesc = styled.div`
  font-size: 12px;
  color: var(--yt-text-muted);
  line-height: 1.7;
`;
