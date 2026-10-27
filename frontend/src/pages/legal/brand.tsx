/*
 * @Description: 语图品牌组件（登录/注册/首页共用）—— Quiet Dark 极简版本
 */

/** 登录/注册页顶部的品牌区：等宽英文标签 + 纯色大标题 + 副标语 */
const BrandTitle = () => (
  <div style={{ textAlign: 'center', marginBottom: 28 }}>
    <div
      className="yt-mono"
      style={{ fontSize: 11, color: 'var(--yt-text-muted)', letterSpacing: '0.24em', marginBottom: 12 }}
    >
      YUTU · AI DIAGRAM
    </div>
    <div
      style={{
        fontSize: 34,
        fontWeight: 600,
        letterSpacing: '0.08em',
        color: 'var(--yt-text-primary)',
      }}
    >
      语 图
    </div>
    <div style={{ fontSize: 13, color: 'var(--yt-text-secondary)', marginTop: 8 }}>
      对话式 AI 流程图生成器
    </div>
  </div>
);

/** 首页等页面的小型品牌标识：纯色字标 + 等宽标签 */
export const BrandLogoSmall = ({ subtitle }: { subtitle?: string }) => (
  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
    <div
      style={{
        fontSize: 20,
        fontWeight: 600,
        letterSpacing: '0.06em',
        color: 'var(--yt-text-primary)',
      }}
    >
      语图
    </div>
    <div className="yt-mono" style={{ fontSize: 10, color: 'var(--yt-text-muted)', letterSpacing: '0.2em' }}>
      {subtitle ?? 'YUTU · AI DIAGRAM'}
    </div>
  </div>
);

export default BrandTitle;
