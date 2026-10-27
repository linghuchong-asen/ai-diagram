/*
 * @Description: 免登录试用页（增长方案核心落地页）
 * 未登录：AI 浮窗走试用链路（POST /ai/trial/chat，匿名 trialId，附注册引导转化）；
 * 已登录：即普通生成入口（浮窗走 /ai/chat 正常链路，projectId 为空时不携带）。
 * 布局：yt-atmo 背景 + 玻璃顶栏（品牌 + FREE TRIAL 标签 + 分享卡/注册 CTA）+ 只读 X6 画布。
 * 魔性传播批次一：顶栏新增「导出分享卡」—— 生成结果一键合成 3:4 品牌卡片 PNG，
 * 这是无备案域名下最主要的传播介质（图片不受微信外链监管）。
 * competitor-driven-evolution-batch Round 19：画布空态新增「四形态引导」——
 *   对比表/待办清单/旅行时间线/读书导图示例 chips，点击拼 ?q=&form= 直达对应产物形态
 *   （浮窗同一 prompt+form 不重发,新组合自动首发）。空态文案与多形态能力对齐。
 */

import { RocketOutlined, PictureOutlined } from "@ant-design/icons";
import { Button, notification } from "antd";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import styled from "@emotion/styled";
import { isTokenValid } from "../../router/private_router";
import { useGraph } from "../../utils/hooks/useGraph";
import { exportDiagramCard } from "../../utils/shareCard";
import { readTrialDraft } from "../../utils/trialIdentity";
import { trackGrowthEvent } from "../share/server";
import AiFloatWindow from "../ai/ai_float_window";
import { BrandLogoSmall } from "../legal/brand";

/**
 * 空态四形态引导（Round 19）：与浮窗 PRESET_PROMPTS 的四形态示例同源，
 * 点击导航到 /trial?q=...&form=<形态>——form 参数经 TrialPage 透传为浮窗 initialFormHint。
 */
const TRIAL_FORM_GUIDES: Array<{ label: string; form: "table" | "checklist" | "timeline" | "mindmap"; prompt: string }> = [
  {
    label: "方案对比表",
    form: "table",
    prompt: "帮我对比「自建」和「采购」两个方案：从成本、工期、维护性、风险几个维度展开，最后给出推荐结论。",
  },
  {
    label: "会议待办清单",
    form: "checklist",
    prompt:
      "把项目周会内容整理成分组待办清单：上线前检查（回归测试、数据库备份、回滚预案）、上线后动作（监控观察、群公告）。",
  },
  {
    label: "旅行时间线",
    form: "timeline",
    prompt:
      "帮我安排成都三天两晚的行程时间线：第一天武侯祠锦里和火锅，第二天大熊猫基地和宽窄巷子，第三天人民公园和返程。",
  },
  {
    label: "读书思维导图",
    form: "mindmap",
    prompt: "把《红楼梦》的知识体系整理成思维导图：四大家族关系、主要人物、经典情节、主题思想。",
  },
];

export const TrialPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  /** 落地页带来的首发提示词（非空时浮窗自动发送一次） */
  const initialPrompt = (searchParams.get("q") ?? "").trim();
  /**
   * 落地页带来的产物形态提示（competitor-driven-evolution-batch Round 18）：
   * /trial?q=...&form=table → 浮窗首发时携带 formHint（FormRouter 直通,不赌关键词路由）;
   * 非法值按无形态处理（后端白名单仍会兜底校验）。
   */
  const rawForm = (searchParams.get("form") ?? "").trim();
  const initialFormHint =
    rawForm === "flowchart" ||
    rawForm === "mindmap" ||
    rawForm === "table" ||
    rawForm === "checklist" ||
    rawForm === "timeline"
      ? rawForm
      : undefined;

  const token = localStorage.getItem("Authorization");
  const loggedIn = useMemo(() => (token ? isTokenValid(token) : false), [token]);
  /** 分享卡导出中（按钮 loading 反馈） */
  const [exportingCard, setExportingCard] = useState(false);

  // 只读预览画布：与 share/preView 页同一套 isPreview 配置（可平移缩放，不可编辑）
  const graph = useGraph({ id: "trial-canvas", callback: () => {}, isPreview: true });

  /** 画布空态（Round 19）：空画布时展示四形态引导；生成应用到画布后自动隐藏 */
  const [canvasEmpty, setCanvasEmpty] = useState(true);
  useEffect(() => {
    if (!graph) return;
    const update = () => setCanvasEmpty(graph.getCellCount() === 0);
    update();
    graph.on("cell:added", update);
    graph.on("cell:removed", update);
    return () => {
      graph.off("cell:added", update);
      graph.off("cell:removed", update);
    };
  }, [graph]);

  /** 点击空态引导：拼 ?q=&form= 触发浮窗首发（同一组合不重发，新组合先挂起 busy 后补发） */
  const handleGuideClick = (guide: (typeof TRIAL_FORM_GUIDES)[number]) => {
    trackGrowthEvent("scenario_submit", { channel: `trial:${guide.form}` });
    navigate(`/trial?q=${encodeURIComponent(guide.prompt)}&form=${guide.form}`);
  };

  /** 导出分享卡：标题取试用草稿里的 prompt（「应用到画布」时已保存），空画布给可行动提示 */
  const handleExportCard = async () => {
    if (!graph) return;
    if (graph.getCellCount() === 0) {
      notification.info({ message: "先让 AI 生成一张图，再来导出分享卡" });
      return;
    }
    setExportingCard(true);
    trackGrowthEvent("card_export", { channel: "trial" });
    try {
      const draft = readTrialDraft();
      await exportDiagramCard({
        graph,
        title: draft?.prompt?.slice(0, 120) || "我的流程图",
      });
      notification.success({ message: "分享卡已导出", description: "发到群/朋友圈，让图替你说话" });
    } catch {
      notification.error({ message: "分享卡导出失败，请重试" });
    } finally {
      setExportingCard(false);
    }
  };

  return (
    <PageShell>
      <div className="yt-atmo" />

      {/* 顶部小栏：品牌 + FREE TRIAL 标签 + 分享卡/注册转化 CTA（已登录则显示额度说明） */}
      <TopBar>
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          FREE TRIAL
        </span>
        <span style={{ flex: 1 }} />
        <Button
          icon={<PictureOutlined />}
          loading={exportingCard}
          onClick={handleExportCard}
          style={{ marginRight: 8 }}
        >
          <span className="yt-hide-mobile">导出分享卡</span>
        </Button>
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
        {/* 空态四形态引导（Round 19）：点击即带 form 直达对应产物形态 */}
        {canvasEmpty ? (
          <StartGuide>
            <GuideTitle>描述你的需求，AI 会选最合适的形态</GuideTitle>
            <GuideSub>
              流程图 · 思维导图 · 对比表格 · 清单 · 时间线 —— 也可以点一个示例直接体验
            </GuideSub>
            <GuideChips>
              {TRIAL_FORM_GUIDES.map((guide) => (
                <span
                  key={guide.form}
                  className="yt-chip"
                  title={guide.prompt}
                  onClick={() => handleGuideClick(guide)}
                >
                  {guide.label}
                </span>
              ))}
            </GuideChips>
          </StartGuide>
        ) : null}
      </CanvasArea>

      {/* AI 浮窗：未登录走试用链路；initialPrompt 非空时自动首发（Round 18：form 参数作 formHint 透传） */}
      <AiFloatWindow
        graph={graph}
        trialMode={!loggedIn}
        initialPrompt={initialPrompt}
        initialFormHint={initialFormHint}
      />
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

/** 空态引导（Round 19）：画布中央浮层，不拦截画布拖拽（外层 pointer-events none，chips 恢复 auto） */
const StartGuide = styled.div`
  position: absolute;
  inset: 0;
  z-index: 2;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 0 24px;
  pointer-events: none;
  text-align: center;
`;

const GuideTitle = styled.div`
  font-size: 18px;
  font-weight: 600;
  color: var(--yt-text-primary);
  letter-spacing: 0.03em;
`;

const GuideSub = styled.div`
  font-size: 12px;
  color: var(--yt-text-secondary);
  line-height: 1.7;
`;

const GuideChips = styled.div`
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 8px;
  pointer-events: auto;
`;
