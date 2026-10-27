// 语图邀请裂变批次 - 邀请码与奖励规则工具（纯函数/常量，前后端口径对齐）
// 规则（对用户说准确，写进活动页与增长文档）：
//   - 每成功邀请 1 位新用户注册：邀请人会员有效期 +1 天（未开通 = 获得当天起 1 天体验会员）；
//   - 邀请奖励单日上限 +3 天（invite_reward_count LEAST 封顶，防小号刷奖励）；
//   - 被邀请的新用户：注册当日生成额度 +2（欢迎礼，与分享奖励同口径叠加，总额度封顶逻辑同 bonus_generate）；
//   - 自邀请（用自己邀请码注册同一账号）不可能成立：注册即新账号，仍做防御校验。
// 合规：自愿激励，无强制/利诱话术；防刷依赖注册 IP 限流（AuthRateLimitGuard）+ 日上限。

/** 邀请码字符集：去除易混淆的 0/O/1/I，8 位可朗读 */
export const INVITE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** 邀请码长度 */
export const INVITE_CODE_LENGTH = 8;

/** 邀请码白名单（与前端 sanitizeInviteCode 同口径） */
export const INVITE_CODE_RE = /^[A-Za-z0-9]{4,16}$/;

/** 邀请奖励单日上限（天） */
export const INVITE_REWARD_DAILY_CAP = 3;

/** 被邀请人欢迎礼（当日生成次数） */
export const INVITE_WELCOME_BONUS = 2;

/**
 * 阶梯邀请里程碑（留存与裂变加强批次）：累计邀请人数跨过阈值时一次性加送会员天数。
 * 领取状态落 invite_milestone 表（每人每档仅一次），跨档自动发放，无需手动领取。
 * 档位调整只改本常量：已发放的里程碑不受影响（幂等键是 count 数值）。
 */
export const INVITE_MILESTONES: ReadonlyArray<{ count: number; days: number }> = [
  { count: 3, days: 3 },
  { count: 10, days: 7 },
];

/** 生成本地时区 YYYY-MM-DD 日键（与 quota.todayKey 同口径，避免跨模块重量级依赖） */
export function inviteDayKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 生成 8 位邀请码（crypto 随机，无歧义字符集） */
export function generateInviteCode(
  randomBytes: (n: number) => Uint8Array = defaultRandomBytes,
): string {
  const bytes = randomBytes(INVITE_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < INVITE_CODE_LENGTH; i++) {
    code += INVITE_ALPHABET[bytes[i] % INVITE_ALPHABET.length];
  }
  return code;
}

/** 默认随机源（独立函数便于单测注入确定性随机） */
function defaultRandomBytes(n: number): Uint8Array {
  // Node crypto 在 Nest 运行时可用；延迟 require 避免纯函数被前端复用时的环境依赖
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomBytes } = require('crypto') as typeof import('crypto');
  return randomBytes(n);
}

/** 清洗用户输入的邀请码：白名单外返回 null（注册流程对非法码一律静默忽略） */
export function sanitizeInviteCode(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const code = raw.trim();
  return INVITE_CODE_RE.test(code) ? code : null;
}
