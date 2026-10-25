/*
 * @Description: 公开分享页 —— 免登录只读查看（V1.1 增长回路核心）
 * 访客经分享链接直达：无需注册即可查看流程图；页内 CTA 引导注册转化。
 * 只读边界：仅渲染画布 + 项目名，无编辑/无导出（登录权益，转化钩子）。
 * 设计语言：Neon Dark，与预览页同构（玻璃顶栏 + 暗色画布 + 自动适配视图）。
 */

import { Button, Spin } from "antd";
import { RocketOutlined } from "@ant-design/icons";
import { useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import BrandTitle from "../legal/brand";
import { BrandLogoSmall } from "../legal/brand";
import { dataClean } from "../preView";
import { useGraph } from "../../utils/hooks/useGraph";
import WatermarkOverlay from "../shared/WatermarkOverlay";
import { useGetShareView } from "./server";

/** 内容居中并自适应缩放到可视区（落地即可读） */
function fitView(graph: ReturnType<typeof useGraph>) {
  if (!graph) return;
  graph.centerContent();
  graph.zoomToFit({ padding: 60, maxScale: 1.2, minScale: 0.2 });
}

export const SharePage = () => {
  const { token } = useParams<{ token: string }>();
  const { data, isLoading, isError } = useGetShareView(token);
  /** 免费档判定：unlocked 后端并行开发中，防御式读取（undefined !== true → 视为未解锁，展示带水印） */
  const unlocked = data?.data?.unlocked === true;

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
      }
    }
  }, [data, graph]);

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
        background: "#0a0f1e",
      }}
    >
      {/* 顶部玻璃横幅：品牌 + 项目名 + 注册转化 CTA */}
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
        <Link to="/register">
          <Button type="primary" className="yt-btn-primary" icon={<RocketOutlined />}>
            免费生成你的图
          </Button>
        </Link>
      </header>

      {/* 画布区（访客只读，可平移缩放） */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div id="container" style={{ width: "100%", height: "100%" }} />
        {/* 免费档水印：右下角低对比，不遮挡图内容；解锁后不渲染 */}
        {!unlocked && <WatermarkOverlay />}
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
        {/* 底部转化提示条：让每一张被分享的图都成为获客入口 */}
        {!isLoading && data?.data && (
          <div className="yt-share-footnote">
            本图由 语图 Yutu 免费生成 · 一句话生成你的流程图
            <Link to="/" className="yt-share-footnote-link">
              去免费生成 →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
};
