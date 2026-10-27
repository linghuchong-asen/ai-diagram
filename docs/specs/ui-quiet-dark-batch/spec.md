# UI 暗色极简改版批次（ui-quiet-dark-batch）Spec

> 状态：已实施（2026-10-28 凌晨批次，前端 25 check 全绿 + tsc 0 错误）｜ 日期：2026-10-28 ｜ 优先级：P0（产品形象）
> 目标：消除「模板站山寨感」，对齐 Linear / Vercel / Eraser 一类高级工具站的设计语言。
> 背景：用户反馈「现在的 UI 太垃圾……看起来就是山寨的网站，没有逼格」。经真实渲染截图诊断，问题不是单一配色，而是整套「Neon Dark 科技感堆料」：渐变标题字 + 辉光 + 呼吸动画 + 扫描光束 + 网格背景 + 玻璃拟态 + Tailwind 默认青紫渐变（#22d3ee→#818cf8），均为 AI 套壳站模板标配。改造方向经双方案高保真 mockup（暗色极简 / 浅色优雅）比选，选定**暗色极简（Quiet Dark）**：编辑器画布本就是暗色，此方向全站改造代价最小、一致性最高。

## Why（山寨感的具体来源 → 逐项消除）

| 山寨感来源（改前证据） | 改后 |
| --- | --- |
| 首页/年报/一图看懂/脑洞/思维导图/场景库/模板 共 9 处标题使用青→紫渐变文字 + 辉光 drop-shadow | 全部改为纯色大标题（weight 600、字距 -0.015em），删除渐变与辉光 |
| `tech-theme.css`：电光青 #22d3ee 强调色、品牌渐变按钮、AI 悬浮球呼吸辉光动画、顶部扫描光束、网格背景、玻璃拟态（backdrop-blur + 渐变描边） | 真中性近黑基底 + 单一克制靛蓝 #7c86e8；主按钮改「白底深字」；悬浮球静置；氛围背景仅保留一点无彩色顶部微光；面板改实色 + 发丝线 |
| 画布/浮窗/配置面板/分享卡片大量蓝紫倾向面（#0a0f1e、#1e2a47、#10182c、#18223d、rgba(30,41,66,*)、rgba(16,24,44,*) 等） | 全量映射到中性色阶（#0b0c0e / #101113 / #15171a / rgba(255,255,255,*)） |
| 品牌组件（登录/注册/首页 logo）渐变字 + 辉光 | 纯色字标 + 弱化等宽标签 |
| X6 连接桩/小地图/选中框沿用 X6 默认青 #31d0c6 | 统一为品牌靛蓝 #7c86e8 |
| 分享卡/年报卡（canvas 导出图）沿用青色主题 | 导出图同步换新色板，与站点一致 |

## What Changes

### MODIFIED-1 设计令牌层重写（`frontend/src/theme/tech-theme.css`）

- 全部类名契约保持不变（`yt-atmo / yt-glass / yt-glass-border / yt-btn-primary / yt-ai-orb / yt-bubble-* / yt-chip / yt-mono / X6 适配 / 水印 / 移动端`），下游页面零改动自动继承。
- 新令牌：`--yt-btn-primary-bg/fg`（白底深字主按钮）、`--yt-bubble-user-bg/fg`（低饱和靛蓝用户气泡）；`--yt-gradient` 令牌重定义为强调色实色（历史引用自动降级，不删除以保兼容）。
- 删除的装饰：`yt-scan` 扫描光束动画、`yt-breathe` 呼吸辉光动画、网格背景 ::before、渐变描边 border-box 技巧、backdrop-blur 毛玻璃。
- X6 工具栏/菜单/stencil/小地图：蓝灰面板 → 中性面板；hover 从强调色改为中性白透明阶。

### MODIFIED-2 页面级清理（9 个渐变标题 + 全站硬编码色清扫）

- 渐变标题改纯色：`home/landing`、`annual`、`digest`、`fun`、`mind`、`scenarios×2`、`templates`（高亮词保留强调色但改实色）、`legal/brand`（品牌字标）。
- 硬编码霓虹色/蓝灰面清零（grep 校验）：`ai_float_window`（去图标辉光、气泡边框走令牌）、`timeline-view`（去点标辉光）、`table-view`、`preView`、`trial`、`invite`、`pricing`、`shared/VipExpiryBanner`、`admin/revenue`、`x6Editor` 配置面板、`useGraph`（画布底/网格/边线/label 中性化）、`minimapView`、`port-groups`、`shareCard.ts` 与 `annualCard.ts`（canvas 导出图色板）。
- `var(--yt-accent, #22d3ee)` 回退值统一清理为 `var(--yt-accent)`。

### 不改什么（明确边界）

- 节点类型功能色（`node-type-config.ts` 的 antd 语义色板）是**内容级**颜色，承担节点类型辨识，不在本次改造范围。
- antd 组件默认蓝（加载中 spinner 等）为组件库行为，后续如需统一走 ConfigProvider 主色定制，另立批次。
- 页面信息结构与文案一律不动，本批次只换设计语言。

## 验收

- 前端 `tsc --noEmit` 0 错误；全部 25 个 `__checks__` 脚本通过。
- 真实渲染截图验收：首页 / 登录 / 模板中心 / 定价 / 试用 / 场景库 均为中性暗色 + 发丝线 + 纯色标题，无渐变字、无辉光、无扫描线、无网格底。
- 全站 grep 无 `#22d3ee / #818cf8 / #31d0c6 / rgba(34,211,238,*)` 残留（`__checks__` 测试夹具除外）。
