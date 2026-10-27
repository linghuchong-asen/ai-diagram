/*
 * @Description: 模板中心 —— 高频流程模板一键生成入口（Task 7）
 * 产品定位：克制版（无搜索/无分页/无详情页），官方静态预置模板 + 分类过滤。
 * 转化动线：点击模板 → /trial?q=<prompt>，试用页浮窗自动发送即出图。
 * 社区模板批次：新增「社区精选」分区 —— 用户投稿作品经审核上架，
 *   点击「查看成品」跳 /share/:token 免登录看图（页内自带复制/注册转化动线）。
 * 设计语言：Neon Dark，与分享页同构（玻璃顶栏 + yt-atmo 氛围背景 + 玻璃卡片）。
 */

import { Button, Spin } from "antd";
import {
  EyeOutlined,
  RocketOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import styled from "@emotion/styled";
import { BrandLogoSmall } from "../legal/brand";
import { trackGrowthEvent } from "../share/server";
import {
  CommunityTemplateItem,
  FlowTemplate,
  useGetCommunityTemplates,
  useGetTemplates,
} from "./server";

/* ---------- 页面骨架（emotion 内嵌样式，不动全局 tech-theme.css） ---------- */

/** 外层：氛围背景 + 顶栏 + 纵向滚动内容区 */
const PageWrap = styled.div`
  position: relative;
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  overflow-x: hidden;
  background: #0a0f1e;
`;

/** 内容容器：限宽居中，悬浮在 yt-atmo 之上 */
const ContentWrap = styled.div`
  position: relative;
  z-index: 1;
  width: 100%;
  max-width: 1080px;
  margin: 0 auto;
  padding: 40px 20px 64px;
`;

/** 标题区：主标（渐变强调）+ 副标（操作指引） */
const HeroTitle = styled.h1`
  margin: 0 0 8px;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--yt-text-primary);
  span {
    background: linear-gradient(135deg, #22d3ee 10%, #818cf8 90%);
    -webkit-background-clip: text;
    background-clip: text;
    -webkit-text-fill-color: transparent;
  }
`;

const HeroSubtitle = styled.p`
  margin: 0 0 24px;
  font-size: 13px;
  color: var(--yt-text-secondary);
`;

/** 分类过滤 chips 行 */
const ChipRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
`;

/** 单个过滤 chip：基于 yt-chip，选中态用电光青高亮（emotion 后注入可覆盖静态类） */
const FilterChip = styled.span<{ $active?: boolean }>`
  ${(props) =>
    props.$active &&
    `
    color: var(--yt-accent);
    border-color: rgba(34, 211, 238, 0.45);
    background: var(--yt-accent-soft);
  `}
`;

/** 模板卡片网格：桌面 3 列，768px 以下单列 */
const TemplateGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 16px;
  @media (max-width: 768px) {
    grid-template-columns: 1fr;
  }
`;

/** 单张卡片：yt-glass-border 出玻璃描边，此处只管布局与 hover 反馈 */
const TemplateCard = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-height: 168px;
  padding: 18px 16px 16px;
  cursor: pointer;
  transition: transform 0.2s ease, box-shadow 0.2s ease;
  &:hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 32px rgba(34, 211, 238, 0.12);
  }
`;

/** 卡片头部：分类标签 + 场景短标签 */
const CardHead = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
`;

const CardScene = styled.span`
  font-size: 12px;
  color: var(--yt-text-muted);
`;

const CardName = styled.div`
  font-size: 15px;
  font-weight: 600;
  color: var(--yt-text-primary);
`;

/** 描述：固定两行，超出省略（保持卡片等高齐整） */
const CardDesc = styled.p`
  margin: 0;
  font-size: 12.5px;
  line-height: 1.7;
  color: var(--yt-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

/** 底部按钮行：贴底对齐 */
const CardFoot = styled.div`
  margin-top: auto;
  display: flex;
  justify-content: flex-end;
`;

/** 加载/空态/失败态容器 */
const StateWrap = styled.div`
  display: grid;
  place-items: center;
  min-height: 260px;
  color: var(--yt-text-secondary);
  font-size: 13px;
`;

/** 分类过滤项（「全部」+ 五个合法分类，顺序与后端枚举一致;「多形态」为 Round 18 新增） */
const CATEGORY_FILTERS: Array<"全部" | FlowTemplate["category"]> = [
  "全部",
  "校园",
  "职场",
  "电商",
  "研发",
  "多形态",
];

export const TemplatesPage = () => {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useGetTemplates();
  /** 社区精选（旁路查询：失败/为空时分区整体隐藏，不影响官方模板主区） */
  const { data: communityData } = useGetCommunityTemplates();
  /** 当前选中分类（undefined 时尚未渲染 chips，默认「全部」） */
  const [activeCategory, setActiveCategory] =
    useState<(typeof CATEGORY_FILTERS)[number]>("全部");

  const templates: FlowTemplate[] = data?.data ?? [];
  /** 社区精选列表（为空时分区整体隐藏） */
  const community: CommunityTemplateItem[] = communityData?.data ?? [];
  /** 分类过滤（纯前端内存过滤，静态数据无需请求） */
  const visibleTemplates = useMemo(
    () =>
      activeCategory === "全部"
        ? templates
        : templates.filter((item) => item.category === activeCategory),
    [templates, activeCategory]
  );

  /** 一键生成：携带完整 prompt 跳试用页，浮窗自动发送即出图；
   *  Round 18：多形态模板追加 &form= 透传（/trial 读取后作为 formHint 直达产物形态） */
  const handleGenerate = (template: FlowTemplate) => {
    const formSuffix = template.formHint ? `&form=${template.formHint}` : "";
    navigate(`/trial?q=${encodeURIComponent(template.prompt)}${formSuffix}`);
  };

  return (
    <PageWrap>
      {/* 氛围背景：与登录/首页同款电光网格 */}
      <div className="yt-atmo" />
      {/* 顶部玻璃横幅：品牌 + 模板中心标识 + 返回入口（结构同分享页） */}
      <header className="yt-share-toolbar">
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span className="yt-mono yt-preview-tag" style={{ marginLeft: 6 }}>
          TEMPLATES
        </span>
        <span
          style={{
            color: "var(--yt-text-primary)",
            fontWeight: 600,
            fontSize: 14,
            marginLeft: 8,
            whiteSpace: "nowrap",
          }}
        >
          模板中心
        </span>
        <span style={{ flex: 1 }} />
        <Link to="/">
          <Button icon={<RocketOutlined />}>返回</Button>
        </Link>
      </header>

      <ContentWrap>
        {/* 标题区：价值主张 + 使用指引 */}
        <HeroTitle>
          高频模板 · <span>一键生成</span>
        </HeroTitle>
        <HeroSubtitle>点击模板进入 AI 对话，补充细节即出图</HeroSubtitle>

        {/* 分类过滤 chips */}
        <ChipRow>
          {CATEGORY_FILTERS.map((category) => (
            <FilterChip
              key={category}
              className="yt-chip"
              $active={activeCategory === category}
              onClick={() => setActiveCategory(category)}
            >
              {category}
            </FilterChip>
          ))}
        </ChipRow>

        {/* 卡片区：加载 / 失败 / 空 / 正常 四态 */}
        {isLoading ? (
          <StateWrap>
            <Spin tip="正在加载模板…" />
          </StateWrap>
        ) : isError ? (
          <StateWrap>
            <div style={{ textAlign: "center", lineHeight: 2 }}>
              模板加载失败，请刷新重试
              <div>
                <Button
                  type="primary"
                  className="yt-btn-primary"
                  onClick={() => refetch()}
                  style={{ marginTop: 12 }}
                >
                  刷新重试
                </Button>
              </div>
            </div>
          </StateWrap>
        ) : visibleTemplates.length === 0 ? (
          <StateWrap>暂无模板</StateWrap>
        ) : (
          <TemplateGrid>
            {visibleTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                className="yt-glass-border"
                onClick={() => handleGenerate(template)}
                title={template.description}
              >
                <CardHead>
                  <span className="yt-mono yt-preview-tag">
                    {template.category}
                  </span>
                  <CardScene>{template.scene}</CardScene>
                </CardHead>
                <CardName>{template.name}</CardName>
                <CardDesc>{template.description}</CardDesc>
                <CardFoot>
                  <Button
                    type="primary"
                    className="yt-btn-primary"
                    icon={<ThunderboltOutlined />}
                    onClick={(event) => {
                      // 阻止冒泡：按钮与整卡均可点击，行为一致，避免触发两次跳转
                      event.stopPropagation();
                      handleGenerate(template);
                    }}
                  >
                    一键生成
                  </Button>
                </CardFoot>
              </TemplateCard>
            ))}
          </TemplateGrid>
        )}

        {/* 社区精选（community-template-batch）：用户投稿作品，审核上架；空/加载失败时整体隐藏 */}
        {community.length > 0 && (
          <>
            <HeroTitle style={{ fontSize: 20, marginTop: 40 }}>
              社区精选 · <span>来自真实用户的图</span>
            </HeroTitle>
            <HeroSubtitle>点击查看完整成品，可一键复制为自己的图继续编辑</HeroSubtitle>
            <TemplateGrid>
              {community.map((item) => (
                <TemplateCard
                  key={item.id}
                  className="yt-glass-border"
                  onClick={() => {
                    // 社区模板点击埋点（漏斗：community_template_click → share_view → share_duplicate）
                    trackGrowthEvent("community_template_click", { templateId: item.id });
                    navigate(`/share/${item.shareToken}`);
                  }}
                  title={item.description}
                >
                  <CardHead>
                    <span className="yt-mono yt-preview-tag">社区精选</span>
                    <CardScene>By {item.ownerName}</CardScene>
                  </CardHead>
                  <CardName>{item.title}</CardName>
                  <CardDesc>{item.description || "点击查看完整成品图"}</CardDesc>
                  <CardFoot>
                    <Button icon={<EyeOutlined />}>查看成品</Button>
                    {/* 热度（模板使用统计批次）：查看数 / 复制数 */}
                    <span
                      className="yt-mono"
                      style={{ fontSize: 10, color: "var(--yt-text-muted)" }}
                    >
                      {item.viewCount ?? 0} 次查看 · {item.copyCount ?? 0} 次复制
                    </span>
                  </CardFoot>
                </TemplateCard>
              ))}
            </TemplateGrid>
          </>
        )}
      </ContentWrap>
    </PageWrap>
  );
};
