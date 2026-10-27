/*
 * @Description: 代码年报页（Round B · 魔性传播 A2）
 * 输入 GitHub/Gitee 用户名 → 只读公开仓库统计 → 导出 3:4 年报卡（传播物）。
 * 传播机制：自我表达型（用开发者自己的数据生成可炫耀截图）；零 LLM 成本。
 * 留存桥（妙鸭教训）：页面常驻 CTA「用一句话画出你的架构」→ /trial 核心体验。
 * 埋点：年报卡导出记 card_export（channel: annual）；报告生成为服务端 annual_generate。
 */

import { RocketOutlined, StarOutlined, GithubOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, Input, Radio, Select, Spin, Alert } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "@emotion/styled";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";
import { exportAnnualCard } from "../../utils/annualCard";
import { AnnualSource, useGetAnnualReport } from "./server";

/** 可选年份：当前年与上一年（跨年窗口想看刚过去的一年） */
const YEAR_OPTIONS = (() => {
  const now = new Date().getFullYear();
  return [now, now - 1, now - 2].map((y) => ({ label: `${y} 年`, value: y }));
})();

export const AnnualPage = () => {
  const navigate = useNavigate();
  const [source, setSource] = useState<AnnualSource>("github");
  const [username, setUsername] = useState("");
  const [year, setYear] = useState(new Date().getFullYear());
  const [submitting, setSubmitting] = useState(false);
  const [exportingCard, setExportingCard] = useState(false);
  const trimmed = username.trim();

  /** 提交查询（react-query enabled 跟随 submitting；换用户名时先复位） */
  const handleSubmit = () => {
    if (!trimmed) return;
    setSubmitting(false);
    // 下一拍再置 true，保证同参数重复提交也能重新发起
    setTimeout(() => setSubmitting(true), 0);
  };

  const { data, isLoading, isError, error, refetch } = useGetAnnualReport({
    source,
    user: trimmed,
    year,
    enabled: submitting,
  });
  const report = data?.data;

  /** 导出年报卡：传播物下载 + 埋点 */
  const handleExportCard = async () => {
    if (!report) return;
    setExportingCard(true);
    trackGrowthEvent("card_export", { channel: "annual" });
    try {
      await exportAnnualCard(report);
    } finally {
      setExportingCard(false);
    }
  };

  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          ANNUAL REPORT
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/fun" style={{ fontSize: 13, color: "var(--yt-text-secondary)", marginRight: 14 }}>
          脑洞显影卡 →
        </Link>
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            注册解锁更多
          </Button>
        </Link>
      </TopBar>

      <HeroPanel className="yt-glass-border">
        <HeroTag className="yt-mono">CODE · YEAR IN REVIEW</HeroTag>
        <HeroTitle>你的 {year}，代码都记得</HeroTitle>
        <HeroSubtitle>
          输入 GitHub / Gitee 用户名，30 秒生成年度代码报告卡 · 只读公开数据 · 免登录
        </HeroSubtitle>

        <FormRow>
          <Radio.Group
            value={source}
            onChange={(e) => setSource(e.target.value as AnnualSource)}
            optionType="button"
            buttonStyle="solid"
          >
            <Radio.Button value="github">GitHub</Radio.Button>
            <Radio.Button value="gitee">Gitee</Radio.Button>
          </Radio.Group>
          <Input
            size="large"
            value={username}
            maxLength={64}
            onChange={(e) => setUsername(e.target.value)}
            onPressEnter={handleSubmit}
            placeholder="输入用户名，如 torvalds"
            style={{ flex: 1, minWidth: 200 }}
          />
          <Select value={year} options={YEAR_OPTIONS} onChange={setYear} style={{ width: 104 }} />
          <Button
            type="primary"
            className="yt-btn-primary"
            size="large"
            icon={<GithubOutlined />}
            disabled={!trimmed}
            loading={isLoading}
            onClick={handleSubmit}
          >
            生成年报
          </Button>
        </FormRow>

        {/* 错误态：上游 404/429/502 由 http 层透传，给出可行动文案与重试 */}
        {isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 18, textAlign: "left", borderRadius: 10 }}
            message="年报生成失败"
            description={
              (error as { message?: string })?.message ??
              "请检查用户名是否正确，或稍后再试（上游接口可能有频率限制）"
            }
            action={
              <Button size="small" danger onClick={() => refetch()}>
                重试
              </Button>
            }
          />
        )}

        {isLoading && (
          <LoadingBlock>
            <Spin />
            <span style={{ marginLeft: 12, color: "var(--yt-text-secondary)", fontSize: 13 }}>
              正在读取 {source === "github" ? "GitHub" : "Gitee"} 公开仓库数据…
            </span>
          </LoadingBlock>
        )}

        {report && !isLoading && (
          <ResultBlock>
            <StatsGrid>
              <StatCard className="yt-glass-border">
                <StatValue>{report.repoCount}{report.repoCountTruncated ? "+" : ""}</StatValue>
                <StatLabel>公开仓库</StatLabel>
              </StatCard>
              <StatCard className="yt-glass-border">
                <StatValue>{report.reposCreatedInYear}</StatValue>
                <StatLabel>年内新建</StatLabel>
              </StatCard>
              <StatCard className="yt-glass-border">
                <StatValue>{report.reposActiveInYear}</StatValue>
                <StatLabel>年内活跃</StatLabel>
              </StatCard>
              <StatCard className="yt-glass-border">
                <StatValue>
                  <StarOutlined style={{ color: "var(--yt-accent)", marginRight: 4 }} />
                  {report.starsTotal}
                </StatValue>
                <StatLabel>累计 Stars</StatLabel>
              </StatCard>
            </StatsGrid>

            {report.topLanguages.length > 0 && (
              <MetaLine className="yt-mono">
                语言：{report.topLanguages.map(([lang, count]) => `${lang} ×${count}`).join("  ·  ")}
              </MetaLine>
            )}
            {report.topRepo && (
              <MetaLine>
                ★ 最受欢迎：<b>{report.topRepo.name}</b>（{report.topRepo.stars} Stars）
              </MetaLine>
            )}
            {report.lastPushedRepo && <MetaLine>最近活跃仓库：{report.lastPushedRepo}</MetaLine>}
            <MetaNote>* 基于公开仓库数据统计（单次最多 100 个仓库）</MetaNote>

            <ActionRow>
              <Button
                type="primary"
                className="yt-btn-primary"
                size="large"
                icon={<PictureOutlined />}
                loading={exportingCard}
                onClick={handleExportCard}
              >
                导出年报分享卡
              </Button>
              <Button size="large" onClick={() => navigate("/trial")}>
                用一句话画出你的架构 →
              </Button>
            </ActionRow>
          </ResultBlock>
        )}
      </HeroPanel>
    </PageWrap>
  );
};

/** 页面外层 */
const PageWrap = styled.div`
  position: relative;
  min-height: 100vh;
  padding: 28px 24px 64px;
  display: flex;
  flex-direction: column;
  align-items: center;
`;

/** 顶部小栏 */
const TopBar = styled.header`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 920px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 44px;
`;

/** 主卡 */
const HeroPanel = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 920px;
  padding: 44px 40px 36px;
  text-align: center;
  @media (max-width: 768px) {
    padding: 28px 18px 24px;
  }
`;

const HeroTag = styled.div`
  font-size: 10px;
  letter-spacing: 0.28em;
  color: var(--yt-accent);
  opacity: 0.85;
  margin-bottom: 16px;
`;

const HeroTitle = styled.h1`
  margin: 0 0 12px;
  font-size: 34px;
  font-weight: 600;?
  letter-spacing: -0.01em;
  color: var(--yt-text-primary);
  @media (max-width: 768px) {
    font-size: 24px;
  }
`;

const HeroSubtitle = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  margin-bottom: 28px;
`;

/** 查询表单行 */
const FormRow = styled.div`
  display: flex;
  gap: 12px;
  align-items: center;
  flex-wrap: wrap;
  justify-content: center;
  .ant-input {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--yt-border);
    color: var(--yt-text-primary);
  }
`;

const LoadingBlock = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  margin-top: 36px;
`;

/** 结果区 */
const ResultBlock = styled.div`
  margin-top: 30px;
`;

/** 2×2 统计宫格 */
const StatsGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

const StatCard = styled.div`
  padding: 18px 12px;
  border-radius: 14px;
`;

const StatValue = styled.div`
  font-size: 30px;
  font-weight: 700;
  color: var(--yt-text-primary);
  margin-bottom: 6px;
`;

const StatLabel = styled.div`
  font-size: 12px;
  color: var(--yt-text-muted);
`;

const MetaLine = styled.div`
  margin-top: 14px;
  font-size: 13px;
  color: var(--yt-text-secondary);
`;

const MetaNote = styled.div`
  margin-top: 10px;
  font-size: 11px;
  color: var(--yt-text-muted);
  opacity: 0.7;
`;

const ActionRow = styled.div`
  display: flex;
  gap: 12px;
  justify-content: center;
  margin-top: 26px;
  flex-wrap: wrap;
`;
