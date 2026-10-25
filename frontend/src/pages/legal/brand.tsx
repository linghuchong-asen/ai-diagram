/*
 * @Description: 语图品牌组件（登录/注册/首页共用）—— Neon Dark 科技感版本
 */

/** 登录/注册页顶部的品牌区：等宽英文标签 + 渐变大标题 + 副标语 */
const BrandTitle = () => (
  <div style={{ textAlign: 'center', marginBottom: 28 }}>
    <div
      className="yt-mono"
      style={{ fontSize: 11, color: 'var(--yt-accent)', letterSpacing: '0.32em', marginBottom: 12, opacity: 0.9 }}
    >
      YUTU · AI DIAGRAM
    </div>
    <div
      style={{
        fontSize: 34,
        fontWeight: 700,
        letterSpacing: '0.14em',
        background: 'linear-gradient(135deg, #22d3ee 10%, #818cf8 90%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
        filter: 'drop-shadow(0 0 18px rgba(34, 211, 238, 0.32))',
      }}
    >
      语 图
    </div>
    <div style={{ fontSize: 13, color: 'var(--yt-text-secondary)', marginTop: 8 }}>
      对话式 AI 流程图生成器
    </div>
  </div>
);

/** 首页等页面的小型品牌标识：渐变 logo + 等宽标签 */
export const BrandLogoSmall = ({ subtitle }: { subtitle?: string }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
    <div
      style={{
        fontSize: 20,
        fontWeight: 700,
        letterSpacing: '0.1em',
        background: 'linear-gradient(135deg, #22d3ee 10%, #818cf8 90%)',
        WebkitBackgroundClip: 'text',
        WebkitTextFillColor: 'transparent',
      }}
    >
      语图
    </div>
    <div className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-text-muted)', letterSpacing: '0.24em' }}>
      {subtitle ?? 'YUTU · AI DIAGRAM'}
    </div>
  </div>
);

export default BrandTitle;
