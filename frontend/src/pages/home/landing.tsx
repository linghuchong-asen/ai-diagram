/*
 * @Description: 未登录落地页（增长方案：免登录试用入口）
 * 访客在首页即可输入一句话 → 跳转 /trial 免登录生成；顶栏常驻登录/注册入口。
 * 快赢批次一(QW6)：快捷 chips 改为 4 组场景（校园毕设/职场/电商/研发）按天轮换，
 * 每组都是完整可编辑的场景化 prompt（豆包式「预判下一步」），占位文案同步轮换 ——
 * 不同日期来访看到不同场景，提升「点一下就能试」的命中率。
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
import { ReactNode, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { BrandLogoSmall } from "../legal/brand";

/** 场景组（按天轮换）：每组 3 条完整可编辑的场景化 prompt，点击填入输入框 */
const PROMPT_GROUPS: Array<{
  groupName: string;
  placeholder: string;
  prompts: Array<{ label: string; text: string }>;
}> = [
  {
    groupName: "校园",
    placeholder: "描述一个流程，如：毕设答辩：提交论文→查重→导师审核→答辩评分",
    prompts: [
      { label: "毕设答辩流程", text: "帮我生成一个毕设答辩流程图：提交论文并查重，查重通过后申请答辩，导师审核，通过则现场答辩并评分，未通过则修改论文后重新查重。" },
      { label: "算法学习路径", text: "帮我生成一个算法学习路径图：从数组链表入门，依次学习栈队列、树与图，每阶段完成练习并通过测验，未通过则复习重练，全部通过后进入结课项目。" },
      { label: "考研复习规划", text: "帮我生成一个考研复习规划流程图：基础阶段过教材，强化阶段刷题并整理错题，真题阶段模考复盘，每阶段未达标则延长本轮，完成后进入冲刺背诵。" },
    ],
  },
  {
    groupName: "职场",
    placeholder: "描述一个流程，如：请假审批：员工提交→主管审批→超 3 天总监复核→人事备案",
    prompts: [
      { label: "请假审批流程", text: "帮我生成一个员工请假审批流程图：员工提交请假申请，直属主管审批，超过 3 天需要部门总监复核，通过后人事备案，驳回则修改后重新提交。" },
      { label: "费用报销流程", text: "帮我生成一个费用报销流程图：员工上传发票提交报销，主管审批后财务审核票据，金额超限需总监审批，通过后打款并通知，驳回则退回补充材料。" },
      { label: "新员工入职", text: "帮我生成一个新员工入职流程图：发放 offer 并确认入职日期，入职当天办理手续领取设备，参加培训并通过考核，试用期结束转正评审，通过则正式转正。" },
    ],
  },
  {
    groupName: "电商",
    placeholder: "描述一个流程，如：订单退款：用户申请→商家审核→原路退回，含协商分支",
    prompts: [
      { label: "订单退款流程", text: "帮我生成一个电商订单退款流程图：用户提交退款申请，商家审核，通过则原路退回并通知用户，拒绝则进入协商，协商不成可申请平台介入。" },
      { label: "拼团流程", text: "帮我生成一个电商拼团流程图：用户发起拼团并支付，分享链接邀请好友参团，人数达标则成团发货，超时未成团则系统自动原路退款。" },
      { label: "售后工单流转", text: "帮我生成一个电商售后工单流程图：用户提交工单，客服分派处理，需退换货则走仓储验收，验收通过退款/换货发出，用户确认后关单，可申请升级处理。" },
    ],
  },
  {
    groupName: "研发",
    placeholder: "描述一个流程，如：部署上线：构建→测试→灰度发布→全量，异常回滚",
    prompts: [
      { label: "部署上线流程", text: "帮我生成一个应用部署上线流程图：提交合并请求，代码评审通过后 CI 构建与自动化测试，通过则灰度发布，灰度正常后全量上线，异常则立即回滚。" },
      { label: "注册登录流程", text: "帮我生成一个用户注册登录流程图：手机号注册、验证码校验、设置密码、登录，含密码错误超限锁定与找回密码分支。" },
      { label: "需求评审流程", text: "帮我生成一个需求评审流程图：产品提交需求文档，组织评审会，技术评估可行性与工作量，通过则排期开发，材料不足则退回补充后重新评审。" },
    ],
  },
];

/** 按天轮换取当日场景组（UTC 天序号取模，本地/服务端一致即可，仅影响展示无需精确时区） */
const dayIndex = Math.floor(Date.now() / 86_400_000);
const TODAY_GROUP = PROMPT_GROUPS[dayIndex % PROMPT_GROUPS.length];

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
  /** 当日场景组（chips + 占位文案同源，构建期已定，无额外状态） */
  const quickPrompts = useMemo(() => TODAY_GROUP.prompts, []);

  /** 跳转试用页：q 参数由浮窗自动首发（免登录链路） */
  const goTrial = () => {
    if (!trimmed) return;
    navigate(`/trial?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <PageWrap>
      {/* 氛围背景：网格 + 光晕 + 扫描光束 */}
      <div className="yt-atmo" />

      {/* 顶栏：品牌 + 邀请/价格/登录/注册小字链接（邀请裂变 + 付费转化增强批次） */}
      <TopBar>
        <BrandLogoSmall />
        <TopLinks>
          <Link to="/invite">邀请有礼</Link>
          <Link to="/pricing">价格</Link>
          <Link to="/login">登录</Link>
          <Link to="/register">注册</Link>
        </TopLinks>
      </TopBar>

      {/* Hero 玻璃主卡：标语 + 大输入框 + 快捷 chips */}
      <HeroPanel className="yt-glass-border">
        <HeroTag className="yt-mono">FREE TRIAL · NO SIGN-UP</HeroTag>
        <HeroTitle>一句话，生成你的流程图</HeroTitle>
        {/* 快赢批次一(QW4)：免登录额度 1 → 2 次，文案同步（「试 2 次」覆盖生成+修正一轮） */}
        <HeroSubtitle>免登录免费试 2 次 · 约 30 秒出图 · 注册后每日 3 次</HeroSubtitle>

        <InputRow>
          <Input
            size="large"
            value={text}
            maxLength={500}
            onChange={(e) => setText(e.target.value)}
            onPressEnter={goTrial}
            placeholder={TODAY_GROUP.placeholder}
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
          {quickPrompts.map((preset) => (
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

        {/* 场景工厂入口（10 个真实使用场景：周报/SQL/伪代码/行程/JD/排查/审批/Git/OKR…） */}
        <FunLinks>
          <Link to="/scenarios" className="yt-mono">
            场景库
          </Link>
          <span style={{ color: "var(--yt-text-muted)" }}>·</span>
          <Link to="/fun" className="yt-mono">
            脑洞显影卡
          </Link>
          <span style={{ color: "var(--yt-text-muted)" }}>·</span>
          <Link to="/digest" className="yt-mono">
            一图看懂
          </Link>
          <span style={{ color: "var(--yt-text-muted)" }}>·</span>
          <Link to="/annual" className="yt-mono">
            代码年报
          </Link>
        </FunLinks>
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

/** 魔性玩法入口行（脑洞显影卡 · 一图看懂） */
const FunLinks = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;
  margin-top: 10px;
  font-size: 11px;
  letter-spacing: 0.14em;
  a {
    color: var(--yt-text-secondary);
    &:hover {
      color: var(--yt-accent);
    }
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
