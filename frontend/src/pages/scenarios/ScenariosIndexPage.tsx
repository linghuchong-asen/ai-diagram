/*
 * @Description: 场景库索引页 —— 全部场景的公共入口（/scenarios）
 * 需求逻辑：每个场景是独立的关键词落地页（承接搜索/社群流量），索引页负责发现与互跳。
 */

import { RocketOutlined, RightOutlined } from "@ant-design/icons";
import { Button } from "antd";
import { Link } from "react-router-dom";
import styled from "@emotion/styled";
import { BrandLogoSmall } from "../legal/brand";
import { SCENARIOS } from "./registry";

export const ScenariosIndexPage = () => {
  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          SCENARIOS
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            注册解锁更多
          </Button>
        </Link>
      </TopBar>

      <HeroPanel className="yt-glass-border">
        <HeroTitle>真实场景，一张图搞定</HeroTitle>
        <HeroSubtitle>
          {SCENARIOS.length} 个高频场景 · 粘贴你的内容 · 免登录 30 秒出图
        </HeroSubtitle>

        <ScenarioGrid>
          {SCENARIOS.map((scenario) => (
            <ScenarioCard
              key={scenario.id}
              className="yt-glass-border"
              to={`/s/${scenario.id}`}
            >
              <CardEmoji>{scenario.emoji}</CardEmoji>
              <CardName>{scenario.name}</CardName>
              <CardTagline>{scenario.tagline}</CardTagline>
              <CardAction className="yt-mono">
                去生成 <RightOutlined style={{ fontSize: 10 }} />
              </CardAction>
            </ScenarioCard>
          ))}
        </ScenarioGrid>
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
  max-width: 960px;
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 40px;
`;

/** 主卡 */
const HeroPanel = styled.section`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 960px;
  padding: 40px 36px 32px;
  text-align: center;
  @media (max-width: 768px) {
    padding: 26px 16px 22px;
  }
`;

const HeroTitle = styled.h1`
  margin: 0 0 10px;
  font-size: 30px;
  font-weight: 700;
  letter-spacing: 0.04em;
  background: linear-gradient(135deg, #22d3ee 10%, #818cf8 90%);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
`;

const HeroSubtitle = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  margin-bottom: 28px;
`;

/** 场景卡宫格：3 列（移动端 2 列） */
const ScenarioGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

/** 单个场景卡（链接卡片） */
const ScenarioCard = styled(Link)`
  display: block;
  padding: 22px 18px;
  border-radius: 14px;
  text-align: left;
  text-decoration: none;
  transition: transform 0.15s ease;
  &:hover {
    transform: translateY(-2px);
  }
`;

const CardEmoji = styled.div`
  font-size: 26px;
  margin-bottom: 8px;
`;

const CardName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--yt-text-primary);
  margin-bottom: 6px;
`;

const CardTagline = styled.div`
  font-size: 12px;
  color: var(--yt-text-muted);
  line-height: 1.7;
  margin-bottom: 10px;
`;

const CardAction = styled.div`
  font-size: 10px;
  letter-spacing: 0.12em;
  color: var(--yt-accent);
`;
