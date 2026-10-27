/*
 * @Description: 预览页面 — 保存后的成品落地页
 * 设计语言：Neon Dark 玻璃顶栏 + 等宽技术标签 + 电光青主操作。
 * 竞品对齐（Whimsical/ProcessOn 分享页）：顶栏提供返回项目列表、适配视图、
 * 导出 PNG/SVG、继续编辑四类高频动作，避免保存后用户被"困"在裸画布。
 * 快赢批次一(QW5)：解锁弹窗 pay/sponsor 两态新增价格锚点文案与「首单特惠」标记
 * （首单价由服务端判定并随下单结果返回 firstOrder，前端只做展示）。
 */

import { Edge, Node } from "@antv/x6";
import { Button, Input, Modal, Space, Spin, Tooltip, notification } from "antd";
import {
  AimOutlined,
  AppstoreAddOutlined,
  ArrowLeftOutlined,
  CrownOutlined,
  DownloadOutlined,
  EditOutlined,
  FileTextOutlined,
  PictureOutlined,
  ShareAltOutlined,
  UnlockOutlined,
} from "@ant-design/icons";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "react-query";
import { getSVgImgUrl } from "../../utils";
import { copyText } from "../../utils/clipboard";
import { exportPng, exportSvg } from "../../utils/exportImage";
import { exportDiagramCard } from "../../utils/shareCard";
import { flowDraftToMermaid } from "../../utils/toMermaid";
import { trackGrowthEvent } from "../share/server";
import { useGraph } from "../../utils/hooks/useGraph";
import { x6ToFlowDraft } from "../ai/transform/to-x6";
import { useIsMobile } from "../../utils/hooks/useIsMobile";
import { useCreateShare } from "../share/server";
import WatermarkOverlay from "../shared/WatermarkOverlay";
import { getUnlockOrder, getVipOrder, getVipStatus, useCreateVipOrder, useUnlockProject } from "./billing";
import { useSubmitCommunityTemplate } from "../templates/server";
import { formatVipExpire } from "./monetize";
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
  /** 分享卡导出中（魔性传播批次一：3:4 品牌卡片 PNG） */
  const [exportingCard, setExportingCard] = useState(false);

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

  /** 未解锁导出确认弹窗：记录待导出格式（转化触点，growth 一页纸 §9.3 挂账需求落地） */
  const [exportConfirm, setExportConfirm] = useState<"png" | "svg" | null>(null);

  const doExport = (format: "png" | "svg") => {
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

  const runExport = (format: "png" | "svg") => {
    // 未解锁：先做水印预览确认（不剥夺导出能力，但把「¥1.9 去水印」价值感知前置）；
    // 已解锁/会员：直接导出，体验不变。
    if (!unlocked) {
      setExportConfirm(format);
      return;
    }
    doExport(format);
  };

  /** 确认弹窗内「仍然带水印导出」 */
  const confirmWatermarkExport = () => {
    const format = exportConfirm;
    setExportConfirm(null);
    if (format) doExport(format);
  };

  /** 魔性传播批次一：导出 3:4 分享卡（图 + 项目名 + 品牌句），传播主介质 */
  const handleExportCard = async () => {
    if (!graph) return;
    setExportingCard(true);
    trackGrowthEvent("card_export", { channel: "preview" });
    try {
      await exportDiagramCard({ graph, title: projectName });
      notification.success({ message: "分享卡已导出", description: "发到群/朋友圈，让图替你说话" });
    } catch {
      notification.error({ message: "分享卡导出失败，请重试" });
    } finally {
      setExportingCard(false);
    }
  };

  /* ===== Round D：Mermaid 代码导出（R3 档二，接入 diagram-as-code 生态） ===== */

  /** Mermaid 弹窗可见性与代码内容 */
  const [mermaidOpen, setMermaidOpen] = useState(false);
  const [mermaidText, setMermaidText] = useState("");

  /** 画布 → FlowDraft → Mermaid 文本（头部带来源署名注释，导出物即传播物） */
  const handleOpenMermaid = () => {
    if (!graph) return;
    const draft = x6ToFlowDraft(graph.toJSON() as never);
    const code = flowDraftToMermaid(draft);
    setMermaidText(code);
    setMermaidOpen(true);
  };

  /** 下载 .mmd 文件（可直接放进仓库让 GitHub/Notion 原生渲染） */
  const handleDownloadMermaid = () => {
    const blob = new Blob([mermaidText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${exportName}.mmd`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1_000);
  };

  /** 复制 Mermaid 代码到剪贴板 */
  const handleCopyMermaid = async () => {
    const copied = await copyText(mermaidText);
    notification[copied ? "success" : "error"]({
      message: copied ? "Mermaid 代码已复制" : "复制失败，请手动选择复制",
    });
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
  const { mutateAsync: createVipOrder, isLoading: creatingVip } = useCreateVipOrder();

  /** 会员状态（顶栏「会员」标识；旁路查询，失败静默按非会员展示） */
  const { data: vipStatus } = useQuery(["vipStatus"], () => getVipStatus(), {
    retry: false,
  });
  const vip = vipStatus?.vip === true;

  /** 解锁弹窗可见性与当前阶段 */
  const [unlockOpen, setUnlockOpen] = useState(false);
  const [unlockPhase, setUnlockPhase] = useState<UnlockPhase>("creating");
  /** 当前在途订单类型：轮询查单按此分发（unlock → /billing/order；vip → /billing/vip/order） */
  const [orderKind, setOrderKind] = useState<"unlock" | "vip">("unlock");
  /** 展示价格（¥X.X，来自订单查询，amount 单位分） */
  const [unlockPrice, setUnlockPrice] = useState<string | null>(null);
  /** 快赢批次一(QW5)：本次下单是否首单优惠价（弹窗展示「首单特惠」标记） */
  const [firstOrder, setFirstOrder] = useState(false);
  /** 会话序号：关闭弹窗/重开/卸载时自增，使旧的下单回调与轮询循环失效退出 */
  const unlockSessionRef = useRef(0);

  // 卸载时使在途轮询失效（ref 自增即可，无需 setState）
  useEffect(() => {
    return () => {
      unlockSessionRef.current++;
    };
  }, []);

  /** 解锁/会员开通成功闭环：刷新项目信息（unlocked 生效 → 水印消失、导出自动无水印） */
  const handleUnlockPaid = () => {
    notification.success({
      message:
        orderKind === "vip"
          ? "会员开通成功，全站导出无水印"
          : "解锁成功，导出已去水印",
    });
    queryClient.invalidateQueries(["useGetProjectInfo", projectid]);
    queryClient.invalidateQueries(["vipStatus"]);
    setUnlockOpen(false);
  };

  /** 轮询订单状态：每 3 秒一次，最多 10 次（首次立即查询带回金额）；paid 即成功闭环 */
  const pollOrderStatus = async (
    session: number,
    orderId: string,
    kind: "unlock" | "vip"
  ) => {
    for (let attempt = 0; attempt < UNLOCK_POLL_MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) await sleep(UNLOCK_POLL_INTERVAL_MS);
      if (unlockSessionRef.current !== session) return;
      try {
        // 按订单类型分发查单端点（两种订单结构仅差 projectId 字段，金额/状态同构）
        const order =
          kind === "vip" ? await getVipOrder(orderId) : await getUnlockOrder(orderId);
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
    setOrderKind("unlock");
    setUnlockOpen(true);
    setUnlockPhase("creating");
    setUnlockPrice(null);
    setFirstOrder(false);
    try {
      const result = (await unlockProject(projectid))?.data;
      if (!result || unlockSessionRef.current !== session) return;
      // 记录首单标记（pay/sponsor 两态弹窗共用）
      if (result.firstOrder === true) setFirstOrder(true);
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
      if (result.orderId) await pollOrderStatus(session, result.orderId, "unlock");
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

  /* ===== 社区模板投稿（community-template-batch）：把我的作品投给模板中心 ===== */

  const { mutateAsync: submitTemplate, isLoading: submitting } = useSubmitCommunityTemplate();
  const [submitOpen, setSubmitOpen] = useState(false);
  const [submitDesc, setSubmitDesc] = useState("");

  /** 投稿：成功后提示审核流（UGC 必审后上架，不承诺上架时间） */
  const handleSubmitTemplate = async () => {
    if (!projectid || submitting) return;
    try {
      await submitTemplate({ projectId: projectid, description: submitDesc.trim() || undefined });
      notification.success({
        message: "投稿成功，审核通过后将在模板中心展示",
        description: "你的署名会随模板一起展示；投稿与分享额度互不影响",
      });
      setSubmitOpen(false);
      setSubmitDesc("");
    } catch {
      // 失败已由 useSubmitCommunityTemplate 统一提示（重复投稿 400 等）
    }
  };

  /**
   * 点击「开通会员月卡」（商业化闭环批次）：与解锁动线同构的分流
   * （pay 跳转 + 轮询 / sponsor 赞助引导）。在期会员可重复下单续费，
   * paid 后到期时间由后端叠加 30 天，全站免水印即时生效。
   */
  const handleOpenVipOrder = async () => {
    const session = ++unlockSessionRef.current;
    setOrderKind("vip");
    setUnlockOpen(true);
    setUnlockPhase("creating");
    setUnlockPrice(null);
    setFirstOrder(false);
    try {
      const result = (await createVipOrder())?.data;
      if (!result || unlockSessionRef.current !== session) return;
      if (result.firstOrder === true) setFirstOrder(true);
      if (result.mode === "sponsor") {
        setUnlockPhase("sponsor");
        if (result.orderId) {
          getVipOrder(result.orderId)
            .then((order) => {
              if (unlockSessionRef.current === session) {
                setUnlockPrice(formatUnlockPrice(order.amount));
              }
            })
            .catch(() => undefined);
        }
        return;
      }
      setUnlockPhase("pay");
      if (result.payUrl) window.open(result.payUrl);
      if (result.orderId) await pollOrderStatus(session, result.orderId, "vip");
    } catch {
      if (unlockSessionRef.current === session) {
        setUnlockOpen(false);
      }
    }
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
          {/* 魔性传播批次一：导出 3:4 分享卡（图片传播不受微信外链限制） */}
          <Tooltip title="导出 3:4 分享卡图片，适合发朋友圈/小红书/群聊">
            <Button
              icon={<PictureOutlined />}
              loading={exportingCard}
              disabled={exporting !== null}
              onClick={handleExportCard}
            >
              分享卡
            </Button>
          </Tooltip>
          {/* 按次付费解锁 CTA：会员在期或单图已解锁 → 展示标签；移动端缩短文案防顶栏溢出 */}
          {unlocked ? (
            <Tooltip
              title={
                vip
                  ? `会员生效中 · ${formatVipExpire(vipStatus?.vipExpireTime)}，全站导出无水印`
                  : "本项目已解锁，导出无水印"
              }
            >
              <span className="yt-mono yt-preview-tag">
                {vip ? "会员·已解锁" : "已解锁"}
              </span>
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
          {/* 社区模板投稿（community-template-batch）：作品被看见的荣誉激励 + 模板长尾供给侧 */}
          <Tooltip title="把这张图投稿到模板中心，审核通过后署名展示给所有访客">
            <Button
              className="yt-hide-mobile"
              icon={<AppstoreAddOutlined />}
              loading={submitting}
              onClick={() => setSubmitOpen(true)}
            >
              投稿模板
            </Button>
          </Tooltip>
          {/* Round D：Mermaid 代码导出（接入 GitHub/Notion 等原生渲染生态） */}
          <Button
            className="yt-hide-mobile"
            icon={<FileTextOutlined />}
            onClick={handleOpenMermaid}
          >
            Mermaid
          </Button>
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

      {/* 未解锁导出水印预览确认（转化触点）：不剥夺导出能力，把 ¥1.9 去水印价值前置 */}
      <Modal
        title="导出预览"
        visible={exportConfirm !== null}
        onCancel={() => setExportConfirm(null)}
        footer={null}
      >
        <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
          <div>您当前是免费版，导出的图将带右下角品牌水印：</div>
          <div
            style={{
              position: "relative",
              margin: "10px 0",
              padding: "20px 14px 24px",
              borderRadius: 8,
              background: "rgba(13,19,38,0.6)",
              border: "1px solid rgba(255,255,255,0.08)",
              overflow: "hidden",
            }}
          >
            <div style={{ fontSize: 12, color: "var(--yt-text-muted)" }}>
              示例：{exportName}.png —— 图内容完整、可直接使用
            </div>
            <div
              style={{
                position: "absolute",
                right: 8,
                bottom: 4,
                fontSize: 10,
                color: "rgba(255,255,255,0.28)",
                pointerEvents: "none",
              }}
            >
              语图 Yutu · 一句话生成流程图 · 免费版
            </div>
          </div>
          <div style={{ marginBottom: 12 }}>
            <b style={{ color: "var(--yt-accent)" }}>¥1.9</b> 一次性解锁本项目：导出与分享永久去水印；
            会员 <b style={{ color: "var(--yt-accent)" }}>¥9.9/月</b> 全站免水印 + 每日 30 次生成。
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <Button onClick={confirmWatermarkExport}>仍然带水印导出</Button>
            <Button
              type="primary"
              className="yt-btn-primary"
              icon={<UnlockOutlined />}
              onClick={() => {
                setExportConfirm(null);
                handleOpenUnlock();
              }}
            >
              解锁去水印 ¥1.9
            </Button>
          </div>
        </div>
      </Modal>

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
            <div>
              已为你打开支付页面，完成支付后将自动
              {orderKind === "vip" ? "开通会员（30 天）。" : "解锁本项目。"}
            </div>
            {orderKind === "vip" && (
              <div>会员权益：全站导出无水印 + 每日 30 次生成，期内新建项目全部生效。</div>
            )}
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>
                {unlockPrice ?? "—"}
              </span>
              {firstOrder && (
                <span className="yt-mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--yt-accent)", letterSpacing: "0.12em" }}>
                  {orderKind === "vip" ? "首月特惠" : "首单特惠"}
                </span>
              )}
              <span style={{ color: "var(--yt-text-muted)" }}>
                （{orderKind === "vip" ? "会员月卡，续费到期自动顺延 30 天" : "一次性解锁，导出永久无水印"}）
              </span>
            </div>
            {/* 快赢批次一(QW5)价格锚点：把「按次付费」翻译成相对会员制的省钱心智 */}
            {orderKind === "unlock" && (
              <div style={{ fontSize: 12, color: "var(--yt-text-muted)" }}>
                同类工具解锁一年要 ¥199+，语图按张付费 —— 只买你需要的这一张。
                <Link to="/pricing">查看完整价格 →</Link>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8 }}>
              <Spin size="small" />
              正在检测支付结果…
            </div>
          </div>
        )}
        {unlockPhase === "sponsor" && (
          <div style={{ fontSize: 13, lineHeight: 1.9, color: "var(--yt-text-secondary)" }}>
            <div>
              {orderKind === "vip"
                ? "收款通道即将开放，可先联系作者赞助开通会员。"
                : "收款通道即将开放，可先联系作者赞助解锁。"}
            </div>
            <div style={{ margin: "8px 0" }}>
              价格：
              <span style={{ color: "var(--yt-accent)", fontWeight: 600, fontSize: 16 }}>
                {unlockPrice ?? "—"}
              </span>
              {firstOrder && (
                <span className="yt-mono" style={{ marginLeft: 8, fontSize: 10, color: "var(--yt-accent)", letterSpacing: "0.12em" }}>
                  {orderKind === "vip" ? "首月特惠" : "首单特惠"}
                </span>
              )}
            </div>
            {/* 快赢批次一(QW5)价格锚点：与 pay 态同口径 */}
            {orderKind === "unlock" && (
              <div style={{ fontSize: 12, color: "var(--yt-text-muted)", marginBottom: 8 }}>
                同类工具解锁一年要 ¥199+，语图按张付费 —— 只买你需要的这一张。
                <Link to="/pricing">查看完整价格 →</Link>
              </div>
            )}
            <div>
              联系邮箱：
              <span
                className="yt-mono"
                style={{ color: "var(--yt-text-primary)" }}
              >
                {SPONSOR_CONTACT_EMAIL}
              </span>
            </div>
            {/* 会员交叉销售：单图解锁动线中引导「更划算」的会员月卡（复购型收入） */}
            {orderKind === "unlock" && (
              <div
                style={{
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <div style={{ fontSize: 12, marginBottom: 8 }}>
                  更划算的选择：会员月卡 <b style={{ color: "var(--yt-accent)" }}>¥9.9/月</b>
                  （首月 ¥5.9）—— 全站导出无水印 + 每日 30 次生成。
                </div>
                <Button
                  size="small"
                  icon={<CrownOutlined />}
                  loading={creatingVip}
                  onClick={handleOpenVipOrder}
                >
                  开通会员月卡
                </Button>
              </div>
            )}
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

      {/* 社区模板投稿弹窗（community-template-batch）：描述选填，审核通过后署名上架 */}
      <Modal
        title="投稿到模板中心"
        visible={submitOpen}
        onCancel={() => setSubmitOpen(false)}
        onOk={handleSubmitTemplate}
        okText="提交投稿"
        confirmLoading={submitting}
        okButtonProps={{ className: "yt-btn-primary" }}
      >
        <div style={{ fontSize: 12, color: "var(--yt-text-secondary)", lineHeight: 1.9, marginBottom: 10 }}>
          投稿内容 = 本项目的成品图（标题取项目名「{projectName}」），审核通过后将在模板中心
          「社区精选」署名展示，访客可免登录查看并可一键复制。
        </div>
        <Input.TextArea
          value={submitDesc}
          onChange={(e) => setSubmitDesc(e.target.value)}
          maxLength={120}
          showCount
          placeholder="一句话说明适用场景（选填，如：适合毕业答辩的技术路线图）"
          autoSize={{ minRows: 2, maxRows: 4 }}
        />
      </Modal>

      {/* Round D：Mermaid 代码导出弹窗 —— 可粘贴到 GitHub README / Notion / 语雀原生渲染 */}
      <Modal
        title="导出 Mermaid 代码"
        visible={mermaidOpen}
        onCancel={() => setMermaidOpen(false)}
        footer={
          <>
            <Button onClick={() => setMermaidOpen(false)}>关闭</Button>
            <Button onClick={handleDownloadMermaid}>下载 .mmd</Button>
            <Button type="primary" className="yt-btn-primary" onClick={handleCopyMermaid}>
              复制代码
            </Button>
          </>
        }
      >
        <div style={{ fontSize: 12, color: "var(--yt-text-secondary)", marginBottom: 10, lineHeight: 1.8 }}>
          粘贴到 GitHub README、Notion、语雀等支持 Mermaid 的地方即可原生渲染；
          代码头部带语图署名注释。
        </div>
        <Input.TextArea
          readOnly
          value={mermaidText}
          autoSize={{ minRows: 8, maxRows: 16 }}
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: 12,
            background: "rgba(13, 19, 38, 0.6)",
            color: "var(--yt-text-primary)",
          }}
        />
      </Modal>
    </div>
  );
};
