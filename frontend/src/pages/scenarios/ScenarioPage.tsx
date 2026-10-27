/*
 * @Description: 场景通用页（场景工厂）—— 渲染注册表中的任意场景配置
 * 统一动线：示例填充 → 粘贴/输入场景文本 → buildPrompt 构造生成指令 → 跳 /trial 免登录生成。
 * 埋点统一为 scenario_submit（channel 区分场景），后端白名单仅此一个事件，后续加场景零后端改动。
 */

import { RocketOutlined } from "@ant-design/icons";
import { Button, Input } from "antd";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import styled from "@emotion/styled";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";
import { findScenario } from "./registry";

export const ScenarioPage = () => {
  const { scenarioId } = useParams<{ scenarioId: string }>();
  const navigate = useNavigate();
  const scenario = findScenario(scenarioId);
  const [text, setText] = useState("");
  const trimmed = text.trim();

  /** 未注册的场景 id：轻量 404 卡（不抛错路由） */
  if (!scenario) {
    return (
      <PageWrap>
        <div className="yt-atmo" />
        <NotFoundCard className="yt-glass-border">
          <div style={{ fontSize: 16, color: "var(--yt-text-primary)", marginBottom: 16 }}>
            场景不存在或已下线
          </div>
          <Link to="/scenarios">
            <Button type="primary" className="yt-btn-primary">
              去场景库看看 →
            </Button>
          </Link>
        </NotFoundCard>
      </PageWrap>
    );
  }

  /** 提交：构造指令跳试用页（浮窗自动首发；Round 17：多形态场景拼 &form= 直达形态） */
  const handleSubmit = () => {
    if (!trimmed) return;
    trackGrowthEvent("scenario_submit", { channel: scenario.channel });
    const formSuffix = scenario.formHint ? `&form=${scenario.formHint}` : "";
    navigate(`/trial?q=${encodeURIComponent(scenario.buildPrompt(trimmed))}${formSuffix}`);
  };

  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          SCENARIO
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/scenarios" style={{ fontSize: 13, color: "var(--yt-text-secondary)", marginRight: 14 }}>
          场景库 →
        </Link>
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            注册解锁更多
          </Button>
        </Link>
      </TopBar>

      <HeroPanel className="yt-glass-border">
        <HeroEmoji>{scenario.emoji}</HeroEmoji>
        <HeroTitle>{scenario.name}</HeroTitle>
        <HeroSubtitle>{scenario.tagline} · 免登录 30 秒出图 · 可导出分享卡</HeroSubtitle>

        <Input.TextArea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={scenario.maxLength}
          showCount
          autoSize={{ minRows: 7, maxRows: 14 }}
          placeholder={scenario.placeholder}
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            color: "var(--yt-text-primary)",
            borderRadius: 12,
            padding: "14px 16px",
            textAlign: "left",
          }}
        />

        <ActionRow>
          <Button
            type="primary"
            className="yt-btn-primary"
            size="large"
            disabled={!trimmed}
            onClick={handleSubmit}
          >
            生成我的{scenario.name}
          </Button>
        </ActionRow>

        {scenario.examples.length > 0 && (
          <ExampleRow>
            {scenario.examples.map((example) => (
              <span
                key={example.label}
                className="yt-chip"
                title={example.text}
                onClick={() => setText(example.text)}
              >
                {example.label}
              </span>
            ))}
          </ExampleRow>
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

/** 未命中场景卡 */
const NotFoundCard = styled.div`
  position: relative;
  z-index: 1;
  margin-top: 120px;
  padding: 40px 44px;
  text-align: center;
`;

/** 顶部小栏 */
const TopBar = styled.header`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 860px;
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
  max-width: 860px;
  padding: 40px 36px 32px;
  text-align: center;
  @media (max-width: 768px) {
    padding: 26px 16px 22px;
  }
`;

const HeroEmoji = styled.div`
  font-size: 34px;
  margin-bottom: 10px;
`;

const HeroTitle = styled.h1`
  margin: 0 0 10px;
  font-size: 30px;
  font-weight: 600;?
  letter-spacing: -0.01em;
  color: var(--yt-text-primary);
  @media (max-width: 768px) {
    font-size: 22px;
  }
`;

const HeroSubtitle = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  margin-bottom: 26px;
`;

const ActionRow = styled.div`
  margin-top: 18px;
`;

/** 示例 chips */
const ExampleRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 18px;
`;
