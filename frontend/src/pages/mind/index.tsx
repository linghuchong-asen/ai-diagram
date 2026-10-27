/*
 * @Description: 「思维体质图」页面（Round E · 魔性传播 A4）
 * 5 道情境题 → 四种思维原型之一 → 结果卡 + 「生成我的思维画像图」直达 /trial。
 * 合规设计：产出物是「思维结构画像图」工具而非测试类 H5 —— 无对错、无预测、
 * 不涉运势命理；分享物为生成出的画像图分享卡（Round A 基建）。
 * 埋点：完成答题记 mind_complete（经 /growth/track，白名单已扩）。
 */

import { RocketOutlined, ExperimentOutlined } from "@ant-design/icons";
import { Button, Radio } from "antd";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "@emotion/styled";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";
import { ARCHETYPES, MIND_QUESTIONS, answeredCount, computeArchetype } from "./archetype";

export const MindPage = () => {
  const navigate = useNavigate();
  /** 每题所选选项下标（-1 未答） */
  const [choices, setChoices] = useState<number[]>(() => MIND_QUESTIONS.map(() => -1));
  /** 是否已提交出结果（提交后锁定选择并展示结果卡） */
  const [revealed, setRevealed] = useState(false);

  const answered = answeredCount(choices);
  const allAnswered = answered === MIND_QUESTIONS.length;
  /** 提交后才计算（避免半途泄露结果） */
  const result = useMemo(() => (revealed ? computeArchetype(choices) : null), [revealed, choices]);

  const selectOption = (questionIndex: number, optionIndex: number) => {
    if (revealed) return; // 已出结果锁定
    setChoices((prev) => prev.map((value, i) => (i === questionIndex ? optionIndex : value)));
  };

  /** 提交：记埋点（带原型结果，衡量哪种原型最引流） */
  const handleReveal = () => {
    if (!allAnswered || revealed) return;
    const archetype = computeArchetype(choices);
    trackGrowthEvent("mind_complete", { channel: `mind:${archetype.key}` });
    setRevealed(true);
  };

  /** 留存桥：生成画像图走免登录试用链路 */
  const goGenerate = () => {
    if (result) navigate(`/trial?q=${encodeURIComponent(result.prompt)}`);
  };

  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          MIND MAP OF MIND
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
        <HeroTag className="yt-mono">HOW DOES YOUR MIND FLOW</HeroTag>
        <HeroTitle>你的思维方式，是哪张图？</HeroTitle>
        <HeroSubtitle>
          5 道情境题 · 30 秒 · 免登录 —— 看看你的大脑是决策树、放射网、泳道还是循环
        </HeroSubtitle>

        <QuestionList>
          {MIND_QUESTIONS.map((question, questionIndex) => (
            <QuestionCard key={question.id} className="yt-glass-border">
              <QuestionTitle>
                <span className="yt-mono" style={{ color: "var(--yt-accent)", marginRight: 8 }}>
                  Q{question.id}
                </span>
                {question.text}
              </QuestionTitle>
              <Radio.Group
                value={choices[questionIndex]}
                onChange={(e) => selectOption(questionIndex, e.target.value as number)}
                disabled={revealed}
              >
                {question.options.map((option, optionIndex) => (
                  <Radio key={option.label} value={optionIndex} style={radioStyle}>
                    {option.label}
                  </Radio>
                ))}
              </Radio.Group>
            </QuestionCard>
          ))}
        </QuestionList>

        <ActionRow>
          {revealed && result ? (
            <>
              <ResultCard className="yt-glass-border">
                <ResultName>{result.name}</ResultName>
                <ResultTagline className="yt-mono">「{result.tagline}」</ResultTagline>
                <ResultDesc>{result.description}</ResultDesc>
              </ResultCard>
              <Button
                type="primary"
                className="yt-btn-primary"
                size="large"
                icon={<ExperimentOutlined />}
                onClick={goGenerate}
              >
                生成我的思维画像图（30 秒）
              </Button>
              <Button size="large" onClick={() => navigate("/digest")}>
                试试一图看懂 →
              </Button>
            </>
          ) : (
            <Button
              type="primary"
              className="yt-btn-primary"
              size="large"
              icon={<RocketOutlined />}
              disabled={!allAnswered}
              onClick={handleReveal}
            >
              {allAnswered ? "看看我是哪种头脑" : `还差 ${MIND_QUESTIONS.length - answered} 题未答`}
            </Button>
          )}
        </ActionRow>

        <LimitHint>
          画像图由 AI 按你的思维结构实时生成，免登录免费试；生成后可导出分享卡发到群里对号入座。
        </LimitHint>
      </HeroPanel>
    </PageWrap>
  );
};

/** 单选项行样式（整行排列，阅读友好） */
const radioStyle = {
  display: "flex",
  alignItems: "flex-start",
  margin: "8px 0",
  color: "var(--yt-text-secondary)",
  fontSize: 13,
  lineHeight: 1.7,
  whiteSpace: "normal" as const,
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

const HeroTag = styled.div`
  font-size: 10px;
  letter-spacing: 0.28em;
  color: var(--yt-accent);
  opacity: 0.85;
  margin-bottom: 14px;
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
  @media (max-width: 768px) {
    font-size: 22px;
  }
`;

const HeroSubtitle = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  margin-bottom: 26px;
`;

/** 题目列表 */
const QuestionList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 14px;
  text-align: left;
`;

const QuestionCard = styled.div`
  padding: 20px 22px;
  border-radius: 14px;
`;

const QuestionTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--yt-text-primary);
  margin-bottom: 12px;
  line-height: 1.7;
`;

/** 操作/结果区 */
const ActionRow = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  margin-top: 26px;
`;

const ResultCard = styled.div`
  width: 100%;
  padding: 26px 24px;
  border-radius: 14px;
  text-align: center;
`;

const ResultName = styled.div`
  font-size: 26px;
  font-weight: 700;
  color: var(--yt-text-primary);
  margin-bottom: 8px;
`;

const ResultTagline = styled.div`
  font-size: 13px;
  color: var(--yt-accent);
  margin-bottom: 14px;
`;

const ResultDesc = styled.div`
  font-size: 13px;
  color: var(--yt-text-secondary);
  line-height: 1.9;
  text-align: left;
`;

const LimitHint = styled.div`
  margin-top: 18px;
  font-size: 12px;
  color: var(--yt-text-muted);
`;
