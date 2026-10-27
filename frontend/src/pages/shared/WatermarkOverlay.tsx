/*
 * @Description: 免费档画布水印覆盖层（展示层）
 * 预览页 / 分享页 / 编辑器三处复用：右下角低对比品牌水印 + 小字「免费版」；
 * pointer-events:none + user-select:none，不遮挡图内容、不拦截画布/工具栏交互；
 * 项目解锁（unlocked === true）后由调用方直接不渲染，全链路无水印。
 * 快赢批次一(QW3)：link=true 时主文案渲染为可点击链接（回首页）—— 分享页水印成为
 * 回流入口；仅文案区域恢复 pointer-events，整层仍不拦截画布交互。
 * 样式收敛在 theme/tech-theme.css 的 .yt-watermark-* 段。
 */

interface WatermarkOverlayProps {
  /** 紧凑模式：上移避让右下角悬浮面板（预览页小地图 / 编辑器 AI 悬浮球），仅改定位不改视觉 */
  compact?: boolean;
  /** 可点击模式（分享页用）：主文案变为回首页链接，水印即广告位 */
  link?: boolean;
}

/** 免费档水印覆盖层：文案主行 + 小字「免费版」；整层默认不响应任何交互 */
const WatermarkOverlay = ({ compact = false, link = false }: WatermarkOverlayProps) => (
  <div
    className={`yt-watermark-overlay${compact ? " yt-watermark-compact" : ""}`}
    aria-hidden={!link}
  >
    {link ? (
      // 可点击水印：仅主文案一行恢复交互（CSS .yt-watermark-link 已单独开 pointer-events）
      <a className="yt-watermark-main yt-watermark-link" href="/" rel="noopener">
        语图 Yutu · 一句话生成流程图
      </a>
    ) : (
      <span className="yt-watermark-main">语图 Yutu · 一句话生成流程图</span>
    )}
    <span className="yt-watermark-sub">免费版</span>
  </div>
);

export default WatermarkOverlay;
