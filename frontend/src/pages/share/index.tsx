/*
 * @Description: 公开分享页 —— 免登录只读查看（V1.1 增长回路核心）
 * 访客经分享链接直达：无需注册即可查看流程图；页内 CTA 引导注册转化。
 * 只读边界：仅渲染画布 + 项目名，无编辑/无导出（登录权益，转化钩子）。
 * 快赢批次一（QW1/QW2/QW3）获客改造：
 *   ① 顶部/底部 CTA 点击埋点（share_cta_click），漏斗「浏览→点击→注册」可测；
 *   ② 「复制这张图开始编辑」：登录用户一键复制为本人项目直达编辑器（Figma Duplicate 式），
 *      未登录用户带 redirect 跳登录/注册，回来自动回到本页再点一次即可；
 *   ③ 底部热门模板推荐位（share_template_click 埋点）承接「看完想自己画」的访客；
 *   ④ 免费档水印文案可点击回首页（水印即回流入口）。
 * 设计语言：Neon Dark，与预览页同构（玻璃顶栏 + 暗色画布 + 自动适配视图）。
 */

import { Button, Spin, notification } from "antd";
import { CopyOutlined, RocketOutlined, UnlockOutlined } from "@ant-design/icons";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import BrandTitle from "../legal/brand";
import { BrandLogoSmall } from "../legal/brand";
import { dataClean } from "../preView";
import { useGraph } from "../../utils/hooks/useGraph";
import { isTokenValid } from "../../router/private_router";
import WatermarkOverlay from "../shared/WatermarkOverlay";
import { markShareSource } from "../../utils/channel";
import { duplicateShare, trackGrowthEvent, useGetShareView } from "./server";

/** 内容居中并自适应缩放到可视区（落地即可读） */
function fitView(graph: ReturnType<typeof useGraph>) {
  if (!graph) return;
  graph.centerContent();
  graph.zoomToFit({ padding: 60, maxScale: 1.2, minScale: 0.2 });
}

/**
 * 热门模板推荐位（静态数据，与后端模板中心同源摘录）：
 * 分享页底部承接「看完想自己画一张」的访客，点击跳试用页免登录生成。
 */
const SHARE_TEMPLATE_RECOMMENDS: Array<{ label: string; prompt: string }> = [
  { label: "毕设答辩流程", prompt: "毕设答辩流程：学生提交论文并查重，查重通过后申请答辩，导师审核，通过则安排现场答辩并评分，未通过则修改论文后重新提交查重" },
  { label: "请假审批流程", prompt: "请假审批流程：员工提交请假申请，直属主管审批，超过 3 天需部门经理复核，通过后人事备案并通知员工，驳回则填写原因退回修改" },
];

export const SharePage = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useGetShareView(token);
  /** 免费档判定：unlocked 后端并行开发中，防御式读取（undefined !== true → 视为未解锁，展示带水印） */
  const unlocked = data?.data?.unlocked === true;
  /** 商业化闭环批次：访问者是项目归属人（后端校验 JWT 后才回传）→ 解锁直达动线 */
  const isOwner = data?.data?.isOwner === true;
  const ownerProjectId = data?.data?.projectId ?? "";
  /** 复制进行中（按钮 loading 反馈） */
  const [duplicating, setDuplicating] = useState(false);

  /** 登录态：决定「复制这张图」直接复制还是先去登录（带 redirect 回本页） */
  const loggedIn = useMemo(() => {
    const stored = localStorage.getItem("Authorization");
    return stored ? isTokenValid(stored) : false;
  }, []);

  const graph = useGraph({
    id: "container",
    callback: () => {},
    isPreview: true,
  });

  useEffect(() => {
    if (data?.data && graph) {
      const { editorData } = data.data;
      if (Array.isArray(editorData)) {
        graph?.fromJSON(dataClean(editorData));
        // 载入后内容居中 + 自适应，访客无需手动缩放找图
        fitView(graph);
        // 分享归因（share-attribution-batch）：落地成功即记录来源 token，
        // 之后任意时点注册都会随请求回传，闭合「share_view → register」漏斗
        markShareSource(token);
      }
    }
  }, [data, graph, token]);

  /** CTA 点击埋点（旁路，失败静默）：token 供后端关联到具体分享页 */
  const trackCta = () => {
    if (token) trackGrowthEvent("share_cta_click", { token });
  };

  /** 模板推荐位点击：带埋点后跳试用页自动生成（免登录） */
  const handleTemplateClick = (prompt: string) => {
    if (token) trackGrowthEvent("share_template_click", { token });
    navigate(`/trial?q=${encodeURIComponent(prompt)}`);
  };

  /**
   * 「复制这张图开始编辑」（QW2，最强注册意图信号）：
   * 已登录 → 复制为新项目直达编辑器；
   * 未登录 → 带 redirect（查询参数 + location.state 双通道）去登录页，
   *          登录/注册链路结束后回到本页，再点一次即完成复制。
   */
  const handleDuplicate = async () => {
    if (!token || duplicating) return;
    trackCta();
    const backPath = `/share/${token}`;
    if (!loggedIn) {
      navigate(`/login?redirect=${encodeURIComponent(backPath)}`, {
        state: { from: { pathname: backPath } },
      });
      return;
    }
    setDuplicating(true);
    try {
      const result = await duplicateShare(token);
      if (result?.projectId) {
        notification.success({ message: "已复制到我的项目，正在打开编辑器…" });
        navigate(
          `/editor/${result.projectId}/${encodeURIComponent(result.projectName)}`
        );
      }
    } catch {
      // 失败提示由 http 层统一弹出；此处仅复位按钮
    } finally {
      setDuplicating(false);
    }
  };

  // 链接失效/不存在：引导注册转化（不区分 404/429，统一失效文案）
  if (isError) {
    return (
      <div
        style={{
          position: "relative",
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
          padding: "24px 16px",
          overflow: "hidden",
        }}
      >
        <div className="yt-atmo" />
        <div
          className="yt-glass-border"
          style={{ position: "relative", zIndex: 1, width: "100%", maxWidth: 420, padding: "40px 36px 30px", textAlign: "center" }}
        >
          <BrandTitle />
          <div style={{ fontSize: 14, color: "var(--yt-text-secondary)", marginBottom: 26, lineHeight: 1.8 }}>
            分享链接不存在或已失效
            <br />
            链接可能已被分享者撤销，或输入有误
          </div>
          <Link to="/register">
            <Button type="primary" className="yt-btn-primary" block icon={<RocketOutlined />}>
              免费用 AI 生成你的流程图
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "#0b0c0e",
      }}
    >
      {/* 顶部玻璃横幅：品牌 + 项目名 + 复制/注册转化 CTA */}
      <header className="yt-share-toolbar">
        <Link to="/" style={{ textDecoration: "none" }}>
          <BrandLogoSmall />
        </Link>
        <span
          className="yt-mono yt-preview-tag yt-hide-mobile"
          style={{ marginLeft: 6 }}
        >
          SHARED VIEW
        </span>
        <span
          title={data?.data?.projectName}
          style={{
            color: "var(--yt-text-primary)",
            fontWeight: 600,
            fontSize: 14,
            marginLeft: 8,
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
            minWidth: 0,
          }}
        >
          {data?.data?.projectName ?? ""}
        </span>
        <span style={{ flex: 1 }} />
        {/* 商业化闭环批次：owner 打开自己的分享链接 → 直达预览页解锁（变现动线最短路径） */}
        {isOwner && !unlocked && ownerProjectId && (
          <Button
            type="primary"
            className="yt-btn-primary"
            icon={<UnlockOutlined />}
            style={{ marginRight: 8 }}
            onClick={() => {
              trackCta();
              navigate(`/preview/${ownerProjectId}`);
            }}
          >
            解锁高清导出
          </Button>
        )}
        {/* QW2：复制这张图（Figma Duplicate 式 —— 「想要这个文件」是最强注册信号） */}
        <Button
          icon={<CopyOutlined />}
          loading={duplicating}
          onClick={handleDuplicate}
          style={{ marginRight: 8 }}
        >
          复制这张图
        </Button>
        <Link to="/register" onClick={trackCta}>
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            免费生成你的图
          </Button>
        </Link>
      </header>

      {/* 画布区（访客只读，可平移缩放） */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div id="container" style={{ width: "100%", height: "100%" }} />
        {/* 免费档水印：右下角低对比，不遮挡图内容；解锁后不渲染；
            QW3：水印文案可点击回首页（仅文案区域响应点击） */}
        {!unlocked && <WatermarkOverlay link />}
        {isLoading && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              placeItems: "center",
              background: "rgba(7, 11, 20, 0.55)",
              zIndex: 100,
            }}
          >
            <Spin tip="正在加载分享内容…" />
          </div>
        )}
        {/* 底部转化区：转化提示条 + 热门模板推荐（让每一张被分享的图都成为获客入口） */}
        {!isLoading && data?.data && (
          <div className="yt-share-footnote">
            <div>
              本图由 语图 Yutu 免费生成 · 一句话生成你的流程图
              {/* 商业化闭环批次：未解锁时把变现价值主张前置（免费版带水印，1.9 元去水印高清） */}
              {!unlocked && (
                <span style={{ color: "var(--yt-text-muted)", marginLeft: 8 }}>
                  免费版带水印，¥1.9 解锁高清无水印
                </span>
              )}
              <Link
                to="/"
                className="yt-share-footnote-link"
                onClick={trackCta}
              >
                去免费生成 →
              </Link>
              {/* 付费转化增强批次：价格页入口（访客可见的盈利橱窗） */}
              <Link
                to="/pricing"
                className="yt-share-footnote-link"
                onClick={trackCta}
              >
                价格 →
              </Link>
            </div>
            <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 8, justifyContent: "center" }}>
              <span style={{ color: "var(--yt-text-muted)", fontSize: 12 }}>
                想画同款？
              </span>
              {SHARE_TEMPLATE_RECOMMENDS.map((tpl) => (
                <span
                  key={tpl.label}
                  className="yt-chip"
                  title={tpl.prompt}
                  onClick={() => handleTemplateClick(tpl.prompt)}
                >
                  {tpl.label}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
