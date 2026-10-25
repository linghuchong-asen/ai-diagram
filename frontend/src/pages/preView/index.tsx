/*
 * @Description: 预览页面 — 保存后的成品落地页
 * 设计语言：Neon Dark 玻璃顶栏 + 等宽技术标签 + 电光青主操作。
 * 竞品对齐（Whimsical/ProcessOn 分享页）：顶栏提供返回项目列表、适配视图、
 * 导出 PNG/SVG、继续编辑四类高频动作，避免保存后用户被"困"在裸画布。
 */

import { Edge, Node } from "@antv/x6";
import { Button, Input, Modal, Space, Spin, Tooltip, notification } from "antd";
import {
  AimOutlined,
  ArrowLeftOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  ShareAltOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQueryClient } from "react-query";
import { getSVgImgUrl } from "../../utils";
import { copyText } from "../../utils/clipboard";
import { exportPng, exportSvg } from "../../utils/exportImage";
import { useGraph } from "../../utils/hooks/useGraph";
import { useIsMobile } from "../../utils/hooks/useIsMobile";
import { useCreateShare } from "../share/server";
import WatermarkOverlay from "../shared/WatermarkOverlay";
import { getUnlockOrder, useUnlockProject } from "./billing";
import { useGetEditorData, useGetProjectInfo } from "./server";
interface PreviewUrlParams {
  projectid: string;
}
export type fromjsonData = Node.Metadata | Edge.Metadata;
// 处理获取到的editor数据（x6Editor 复用同一实现，避免重复 dataClean）
export function dataClean(data: fromjsonData[]) {
  const tempData: fromjsonData[] = JSON.parse(JSON.stringify(data));
  const result = tempData.map((item) => {
    if (item.shape === "image") {
      const img = item.attrs.image["xlink:href"];
      item.attrs.image["xlink:href"] = getSVgImgUrl(img);
    }
    return item;
  });
  return result;
}

/** 内容居中并自适应缩放到可视区（落地即可读） */
function fitView(graph: ReturnType<typeof useGraph>) {
  if (!graph) return;
  graph.centerContent();
  graph.zoomToFit({ padding: 60, maxScale: 1.2, minScale: 0.2 });
}

/* ===== 按次付费解锁动线（Task 6.3/6.4） ===== */

/** 支付结果轮询参数：每 3 秒一次，最多 10 次（首次立即查询，顺带带回金额展示） */
const UNLOCK_POLL_INTERVAL_MS = 3000;
const UNLOCK_POLL_MAX_ATTEMPTS = 10;
/** 赞助引导联系邮箱（占位：收款通道开放前的人工解锁入口） */
const SPONSOR_CONTACT_EMAIL = "support@yutu.app";

/** 订单金额（分）→ 展示价格（¥X.X） */
const formatUnlockPrice = (amount: number) => `¥${(amount / 100).toFixed(1)}`;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** 解锁弹窗阶段：creating 下单中 / pay 支付跳转+轮询中 / sponsor 赞助引导 / timeout 轮询超时 */
type UnlockPhase = "creating" | "pay" | "sponsor" | "timeout";

export const PreViewPage = () => {
  const { projectid } = useParams<keyof PreviewUrlParams>();
  const navigate = useNavigate();
  /** 当前导出中的格式（按钮 loading 反馈） */
  const [exporting, setExporting] = useState<"png" | "svg" | null>(null);

  const { data, isLoading } = useGetEditorData({
    projectId: projectid as string,
  });
  const { data: projectInfo } = useGetProjectInfo(projectid);
  /** 免费档判定：unlocked 后端并行开发中，防御式读取（undefined !== true → 视为未解锁，展示/导出带水印） */
  const unlocked = projectInfo?.data?.unlocked === true;
  /** V1.1 创建分享链接（幂等）：复制到剪贴板，复制失败降级弹窗手动复制 */
  const { mutateAsync: createShare, isLoading: sharing } = useCreateShare();

  const graph = useGraph({
    id: "container",
    callback: () => { },
    isPreview: true,
  });

  useEffect(() => {
    if (data?.data && graph) {
      const { editorData } = data.data;
      if (Array.isArray(editorData)) {
        graph?.fromJSON(dataClean(editorData));
        // 载入后内容居中 + 自适应，无需手动缩放找图
        fitView(graph);
      }
    }
  }, [data, graph]);

  useEffect(() => {
    if (!projectid) {
      notification.error({
        message: "项目id为空",
      });
    }
  }, [projectid]);

  const projectName =
    projectInfo?.data?.project_name?.trim() || `项目 ${projectid ?? ""}`;
  const exportName = projectName || "yutu-diagram";

  const runExport = (format: "png" | "svg") => {
    if (!graph) return;
    setExporting(format);
    // 免费档：导出物右下角注入低对比水印（unlocked 字段到位后自动关闭）
    const watermarkOptions = { watermark: !unlocked };
    const task =
      format === "png"
        ? exportPng(graph, exportName, 2, watermarkOptions)
        : exportSvg(graph, exportName, watermarkOptions);
    task
      .then(() => {
        notification.success({
          message: `已导出 ${format.toUpperCase()}：${exportName}`,
        });
      })
      .catch(() => {
        notification.error({ message: "导出失败，请重试" });
      })
      .finally(() => setExporting(null));
  };

  /** V1.1 生成分享链接（幂等）：他人免登录查看；复制失败降级为弹窗手动复制 */
  const handleShare = async () => {
    if (!projectid) return;
    try {
      const response = await createShare(projectid);
      const shareToken = response?.data?.shareToken as string | undefined;
      if (!shareToken) return;
      const shareUrl = `${window.location.origin}/share/${shareToken}`;
      const copied = await copyText(shareUrl);
      if (copied) {
        notification.success({
          message: "分享链接已复制",
          description: "发送给朋友，无需注册即可查看",
        });
      } else {
        Modal.info({
          title: "复制失败，请手动复制以下链接",
          content: <Input readOnly value={shareUrl} style={{ marginTop: 8 }} />,
        });
      }
    } catch {
      // 创建失败已由 useCreateShare 的 onError 统一提示
    }
  };

  /* ===== 按次付费解锁动线（Task 6.3/6.4）：下单 → 支付/赞助引导 → 轮询 → 刷新项目态 ===== */

  const queryClient = useQueryClient();
  const isMobile = useIsMobile();
  const { mutateAsync: unlockProject, isLoading: unlocking } = useUnlockProject();

  /** 解锁弹窗可见性与当前阶段 */
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPhase, setUnlockPhase] = useState<UnlockPhase>("creating");
  /** 展示价格（¥X.X，来自订单查询，amount 单位分） */
  const [unlockPrice, setUnlockPrice] = useState<string | null>(null);
  /** 会话序号：关闭弹窗/重开/卸载时自增，使旧的下单回调与轮询循环失效退出 */
  const unlockSessionRef = useRef(0);

  // 卸载时使在途轮询失效（ref 自增即可，无需 setState）
  useEffect(() => {
    return () => {
      unlockSessionRef.current++;
    };
  }, []);

  /** 解锁成功闭环：刷新项目信息（unlocked 生效 → 水印消失、导出自动无水印） */
  const handleUnlockPaid = () => {
    notification.success({ message: "解锁成功，导出已去水印" });
    queryClient.invalidateQueries(["useGetProjectInfo", projectid]);
    setUnlockOpen(false);
  };

  /** 轮询订单状态：每 3 秒一次，最多 10 次（首次立即查询带回金额）；paid 即成功闭环 */
  const pollOrderStatus = async (session: number, orderId: string) => {
    for (let attempt = 0; attempt < UNLOCK_POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(UNLOCK_POLL_INTERVAL_MS);
      if (unlockSessionRef.current !== session) return;
      try {
        const order = await getUnlockOrder(orderId);
        if (unlockSessionRef.current !== session) return;
        setUnlockPrice(formatUnlockPrice(order.amount));
        if (order.status === "paid") {
          handleUnlockPaid();
          return;
        }
      } catch {
        // 单次查询失败不中断轮询（网络抖动容错）
      }
    }
    if (unlockSessionRef.current === session) {
      setUnlockPhase("timeout");
    }
  };

  /** 点击「解锁高清导出」：打开弹窗并下单，按返回模式分流（pay / sponsor / alreadyUnlocked） */
  const handleOpenUnlock = async () => {
    if (!projectid) return;
    const session = ++unlockSessionRef.current;
    setUnlockOpen(true);
    setUnlockPhase("creating");
    setUnlockPrice(null);
    try {
      const result = (await unlockProject(projectid))?.data;
      if (!result || unlockSessionRef.current !== session) return;
      if (result.alreadyUnlocked) {
        // 项目已是解锁态：直接按成功闭环处理
        handleUnlockPaid();
        return;
      }
      if (result.mode === "sponsor") {
        // 收款通道未配置：赞助引导（不报错不阻断），顺带查一次订单取价格展示
        setUnlockPhase("sponsor");
        if (result.orderId) {
          getUnlockOrder(result.orderId)
            .then((order) => {
              if (unlockSessionRef.current === session) {
                setUnlockPrice(formatUnlockPrice(order.amount));
              }
            })
            .catch(() => undefined); // 价格展示失败不影响引导
        }
        return;
      }
      // mode==='pay'：新窗口打开支付网关 + 轮询支付结果
      setUnlockPhase("pay");
      if (result.payUrl) window.open(result.payUrl);
      if (result.orderId) await pollOrderStatus(session, result.orderId);
    } catch {
      // 下单失败已由 useUnlockProject 的 onError 统一提示；关闭弹窗可重试
      if (unlockSessionRef.current === session) {
        setUnlockOpen(false);
      }
    }
  };

  /** 关闭解锁弹窗：使在途轮询/下单回调失效 */
  const handleCloseUnlock = () => {
    unlockSessionRef.current++;
    setUnlockOpen(false);
  };

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
      {/* 顶部玻璃工具栏：返回 / 项目名 / 适配视图 / 导出 / 继续编辑 */}
      <header className="yt-preview-toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <Tooltip title="返回项目列表">
            <Button
              type="text"
              icon={<ArrowLeftOutlined style={{ color: "var(--yt-text-secondary)" }} />}
              onClick={() => navigate("/")}
            />
          </Tooltip>
          <span className="yt-mono yt-preview-tag yt-hide-mobile">PREVIEW</span>
          <span
            title={projectName}
            style={{
              color: "var(--yt-text-primary)",
              fontWeight: 600,
              fontSize: 14,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {projectName}
          </span>
        </div>
        <Space>
          <span className="yt-hide-mobile">
            <Tooltip title="适配视图：内容居中并缩放到可视区">
              <Button icon={<AimOutlined />} onClick={() => fitView(graph)}>
                适配视图
              </Button>
            </Tooltip>
          </span>
          <Button
            className="yt-hide-mobile"
            icon={<FileTextOutlined />}
            loading={exporting === "svg"}
            disabled={exporting !== null && exporting !== "svg"}
            onClick={() => runExport("svg")}
          >
            导出 SVG
          </Button>
          <Button
            icon={<DownloadOutlined />}
            loading={exporting === "png"}
            disabled={exporting !== null && exporting !== "png"}
            onClick={() => runExport("png")}
          >
            导出 PNG
          </Button>
          <Tooltip title="生成免登录分享链接，发送给朋友即可查看（V1.1 新增）">
            <Button icon={<ShareAltOutlined />} loading={sharing} onClick={handleShare}>
              分享
            </Button>
          </Tooltip>
          {/* 按次付费解锁 CTA：已解锁后隐藏按钮、改显「已解锁」标签；移动端缩短文案防顶栏溢出 */}
          {unlocked ? (
            <Tooltip title="本项目已解锁，导出无水印">
              <span className="yt-mono yt-preview-tag">已解锁</span>
            </Tooltip>
          ) : (
            <Tooltip title="按次付费解锁本项目，导出与分享永久去水印">
              <Button
                type="primary"
                className="yt-btn-primary"
                icon={<UnlockOutlined />}
                loading={unlocking}
                onClick={handleOpenUnlock}
              >
                {isMobile ? "解锁" : "解锁高清导出"}
              </Button>
            </Tooltip>
          )}
          <Button
            type="primary"
            className="yt-btn-primary"
            icon={<EditOutlined />}
            onClick={() =>
              navigate(`/editor/${projectid}/${encodeURIComponent(projectName)}`)
            }
          >
            继续编辑
          </Button>
        </Space>
      </header>

      {/* 画布区（工具栏下方自适应填充） */}
      <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
        <div id="container" style={{ width: "100%", height: "100%" }} />
        {/* 小地图容器：与编辑器同一 DOM 约定（useGraph 按 id 挂载）；移动端隐藏避免遮挡内容 */}
        <div id="minimapContainer" className="yt-preview-minimap yt-hide-mobile" />
        {/* 免费档水印：compact 上移避让右下角小地图；解锁后全链路不渲染 */}
        {!unlocked && <WatermarkOverlay compact />}
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
            <Spin tip="正在加载图表…" />
          </div>
        )}
      </div>

      {/* 解锁高清导出弹窗：creating / pay（支付+轮询）/ sponsor（赞助引导）/ timeout 四态 */}
      <Modal
        title="解锁高清导出"
        visible={unlockOpen}
        onCancel={handleCloseUnlock}
        footer={
          unlockPhase === "creating" || unlockPhase === "pay" ? (
            <Button onClick={handleCloseUnlock}>取消</Button>
          ) : (
            <Button type="primary" className="yt-btn-primary" onClick={handleCloseUnlock}>
              知道了
            </Button>
          )
        }
      >
        {unlockPhase === "creating" && (
          <div style={{ padding: "18px 0", textAlign: "center" }}>
            <Spin />
            <div
              style={{
                marginTop: 12,
                fontSize: 13,
                color: "var(--yt-text-secondary)",
              }}
            >
              正在创建解锁订单…
            </div>
          </div>
        )}
        {unlockPhase === "pay" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>已为你打开支付页面，完成支付后将自动解锁本项目。</div>
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>
                {unlockPrice ?? "—"}
              </span>
              <span style={{ color: "var(--yt-text-muted)" }}>（一次性解锁，导出永久无水印）</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Spin size="small" />
              正在检测支付结果…
            </div>
          </div>
        )}
        {unlockPhase === "sponsor" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>收款通道即将开放，可先联系作者赞助解锁。</div>
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>
                {unlockPrice ?? "—"}
              </span>
            </div>
            <div>
              联系邮箱：
              <span
                className="yt-mono"
                style={{ color: "var(--yt-text-primary)" }}
              >
                {SPONSOR_CONTACT_EMAIL}
              </span>
            </div>
          </div>
        )}
        {unlockPhase === "timeout" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>未检测到支付，可稍后在订单页查看。</div>
            <div style={{ color: "var(--yt-text-muted)" }}>
              若已完成支付，解锁会自动生效；也可重新点击「解锁高清导出」查询状态。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};
