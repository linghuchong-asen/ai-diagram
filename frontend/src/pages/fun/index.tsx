/*
 * @Description: 「脑洞显影卡」魔性入口页（魔性传播批次一 · A3）
 * 娱乐向获客前锋：预置梗场景（拖延症/点外卖/精神状态…）+ 自定义输入，
 * 点击跳 /trial?q= 走免登录试用链路生成，成品可导出分享卡（形成传播闭环）。
 * 传播机制：娱乐型「成品即内容」；生成结果自带梗属性，用户主动晒（失败也可爱）。
 * 埋点：chips 点击记 fun_chip_click（经 /growth/track），衡量各梗场景的引流效率。
 */

import { RocketOutlined, ThunderboltOutlined } from "@ant-design/icons";
import styled from "@emotion/styled";
import { Button, Input } from "antd";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";

/** 预置梗场景：prompt 即完整生成指令（幽默但结构合法，保证引擎能画出正确的流程图） */
const FUN_PRESETS: Array<{ label: string; text: string }> = [
  {
    label: "拖延症决策树",
    text: "画一个「我的拖延症决策树」：任务来了 → 先判断难不难，难则刷十分钟手机，简单则判断急不急，不急则明天再说，急则估算还剩几小时，剩得多则再刷会儿，剩得少则开始干活，干五分钟奖励自己刷手机，回到起点",
  },
  {
    label: "点外卖决策流",
    text: "画一个「中午点外卖的完整决策流程」：打开 App → 看看收藏 → 都吃腻了 → 随机逛 30 分钟 → 购物车加了又删 → 决定减脂吃沙拉 → 结账前看到满减 → 加一个奶茶 → 等餐 40 分钟 → 饭到了凉了 → 发誓明天自己带饭 → 第二天继续点外卖",
  },
  {
    label: "周一精神状态",
    text: "画一个「周一早上的精神状态流程图」：闹钟响 → 关掉再睡 5 分钟 → 循环 4 次 → 惊醒看表 → 判断迟到风险 → 高则狂奔出门，低则洗漱 → 到工位 → 打开电脑 → 假装忙碌实际发呆 → 喝第一杯咖啡 → 系统逐渐启动 → 周一终于过去 → 立flag下周日早睡",
  },
  {
    label: "答辩心理活动",
    text: "画一个「毕业答辩现场心理活动流程图」：轮到自己 → 上台 → 开始陈述 → 看到评委皱眉 → 内心慌张 → 评委提问 → 判断会不会答 → 会则从容作答，不会则「这个问题很好我后续研究」 → 评委点头 → 松一口气 → 等待结果 → 通过 → 激动 → 结束",
  },
  {
    label: "双十一剁手流",
    text: "画一个「双十一购物决策流程」：看到直播 → 主播说最后 100 件 → 判断是否需要 → 告诉自己不需要 → 但有满减 → 凑单 → 又加三件 → 付款前看余额 → 分期免息 → 付款 → 收货 → 退货流程：试穿 → 不合适 → 退掉凑单品 → 留下本来那件 → 下月吃土",
  },
  {
    label: "开黑甩锅流程",
    text: "画一个「游戏开黑甩锅流程图」：团战输了 → 判断自己有没有死 → 死了则检查是谁没跟上 → 辅助没跟则「辅助呢」，跟了则「打野呢」→ 都在则「网卡了」→ 队友开始互相甩锅 → 有人退出语音 → 赢一把就睡 → 循环到凌晨两点",
  },
];

export const FunPage = () => {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const trimmed = text.trim();

  /** 跳试用页生成（q 由浮窗自动首发） */
  const goTrial = (prompt: string) => {
    navigate(`/trial?q=${encodeURIComponent(prompt)}`);
  };

  /** 梗场景点击：埋点 + 跳转 */
  const handlePresetClick = (preset: { label: string; text: string }) => {
    trackGrowthEvent("fun_chip_click", { channel: `fun:${preset.label}` });
    goTrial(preset.text);
  };

  return (
    <PageWrap>
      <div className="yt-atmo" />

      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          FUN LAB
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/digest" style={{ fontSize: 13, color: "var(--yt-text-secondary)", marginRight: 14 }}>
          一图看懂 →
        </Link>
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            注册解锁更多
          </Button>
        </Link>
      </TopBar>

      <HeroPanel className="yt-glass-border">
        <HeroTag className="yt-mono">AI FLOWCHART MEME GENERATOR</HeroTag>
        <HeroTitle>把你脑子里的一团乱麻，画成一张图</HeroTitle>
        <HeroSubtitle>
          选一个梗 · 免登录 30 秒出图 · 导出分享卡发群里，看看谁对号入座
        </HeroSubtitle>

        <PresetGrid>
          {FUN_PRESETS.map((preset) => (
            <PresetCard
              key={preset.label}
              className="yt-glass-border"
              title={preset.text}
              onClick={() => handlePresetClick(preset)}
            >
              <PresetIcon>
                <ThunderboltOutlined />
              </PresetIcon>
              <PresetTitle>{preset.label}</PresetTitle>
            </PresetCard>
          ))}
        </PresetGrid>

        <CustomRow>
          <Input
            size="large"
            maxLength={500}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={() => trimmed && goTrial(trimmed)}
            placeholder="或者自己写：如「我家的年夜饭谁做决策流程」"
          />
          <Button
            type="primary"
            className="yt-btn-primary"
            size="large"
            icon={<RocketOutlined />}
            disabled={!trimmed}
            onClick={() => goTrial(trimmed)}
          >
            显影
          </Button>
        </CustomRow>
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
  font-size: 32px;
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
  margin-bottom: 30px;
`;

/** 梗场景宫格：3 列（移动端 2 列） */
const PresetGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
  @media (max-width: 768px) {
    grid-template-columns: repeat(2, 1fr);
  }
`;

/** 单个梗场景卡（hover 抬升暗示可点） */
const PresetCard = styled.div`
  padding: 20px 16px;
  border-radius: 14px;
  cursor: pointer;
  transition: transform 0.15s ease, border-color 0.15s ease;
  &:hover {
    transform: translateY(-2px);
  }
`;

const PresetIcon = styled.div`
  font-size: 18px;
  color: var(--yt-accent);
  margin-bottom: 8px;
`;

const PresetTitle = styled.div`
  font-size: 14px;
  font-weight: 600;
  color: var(--yt-text-primary);
`;

/** 自定义输入行 */
const CustomRow = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 24px;
  .ant-input {
    background: rgba(255, 255, 255, 0.04);
    border-color: var(--yt-border);
    color: var(--yt-text-primary);
  }
  @media (max-width: 768px) {
    flex-direction: column;
  }
`;
