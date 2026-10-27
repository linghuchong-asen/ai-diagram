/*
 * @Description: 注册渠道归因工具（增长快赢批次一 QW1）
 * 用途：在应用入口捕获 URL 中的渠道参数（?ch= / utm_source / from），存入 localStorage；
 *       注册时随请求提交（后端 register 埋点携带 channel），实现「渠道 → 注册」归因。
 * 约定：只在渠道参数存在时写入（首次触达优先，不覆盖已归因渠道）；
 *       渠道码仅限 [a-zA-Z0-9_-]，其余字符剔除，长度 ≤64，防御脏数据。
 */

/** 渠道标识的 localStorage key */
const CHANNEL_KEY = "yutu_channel";

/** 渠道参数的候选 key 列表（优先级从高到低：ch 是运营自定义短码，utm_source/from 为通用兜底） */
const CHANNEL_PARAM_KEYS = ["ch", "utm_source", "from"];

/** 合法渠道码字符集（字母/数字/下划线/连字符/点号） */
const CHANNEL_CHAR_RE = /[^\w.-]/g;

/**
 * 应用入口调用一次：从当前 URL 捕获渠道参数并持久化。
 * 已有渠道时不覆盖 —— 归因讲「首次触达」，避免后续跳转（如登录回调）污染渠道。
 */
export function captureChannelOnce(): void {
  try {
    const search = new URLSearchParams(window.location.search);
    let channel = "";
    for (const key of CHANNEL_PARAM_KEYS) {
      const value = (search.get(key) ?? "").trim();
      if (value) {
        channel = value;
        break;
      }
    }
    if (!channel) return;
    const cleaned = channel.replace(CHANNEL_CHAR_RE, "").slice(0, 64);
    if (!cleaned) return;
    if (!localStorage.getItem(CHANNEL_KEY)) {
      localStorage.setItem(CHANNEL_KEY, cleaned);
    }
  } catch {
    // localStorage 不可用（隐私模式等）：归因是旁路能力，静默失败
  }
}

/** 读取已归因的渠道码（无归因返回 undefined，注册请求省略该字段） */
export function readChannel(): string | undefined {
  try {
    const value = (localStorage.getItem(CHANNEL_KEY) ?? "").trim();
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 邀请码捕获（邀请裂变批次）：?ic= / invite_code → localStorage
// ---------------------------------------------------------------------------

/** 邀请码的 localStorage key */
const INVITE_KEY = "yutu_invite_code";

/** 邀请码候选参数（ic 为邀请链接短参，invite_code 为兼容全称） */
const INVITE_PARAM_KEYS = ["ic", "invite_code"];

/**
 * 应用入口调用一次：从当前 URL 捕获邀请码并持久化。
 * 与渠道归因同策略：已有邀请码时不覆盖（首次触达优先）；
 * 白名单 [A-Za-z0-9]{4,16}，非法码静默丢弃（后端注册同样做白名单校验）。
 */
export function captureInviteCodeOnce(): void {
  try {
    const search = new URLSearchParams(window.location.search);
    let code = "";
    for (const key of INVITE_PARAM_KEYS) {
      const value = (search.get(key) ?? "").trim();
      if (value) {
        code = value;
        break;
      }
    }
    if (!code) return;
    if (!/^[A-Za-z0-9]{4,16}$/.test(code)) return;
    if (!localStorage.getItem(INVITE_KEY)) {
      localStorage.setItem(INVITE_KEY, code);
    }
  } catch {
    // localStorage 不可用（隐私模式等）：邀请码是旁路能力，静默失败
  }
}

/** 读取已捕获的邀请码（无则 undefined，注册请求省略该字段） */
export function readInviteCode(): string | undefined {
  try {
    const value = (localStorage.getItem(INVITE_KEY) ?? "").trim();
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 分享归因（share-attribution-batch）：分享页落地 → localStorage → 注册随请求提交
// ---------------------------------------------------------------------------

/** 分享归因的 localStorage key */
const SHARE_SOURCE_KEY = "yutu_share_token";

/** 分享 token 白名单：32 位十六进制（与后端 project_share.shareToken 同构） */
const SHARE_TOKEN_RE = /^[0-9a-f]{32}$/;

/**
 * 分享页落地成功后调用：记录来源分享 token（首次触达优先，不覆盖）。
 * 非法 token 静默丢弃；localStorage 不可用（隐私模式）静默失败 —— 归因是旁路能力。
 */
export function markShareSource(token: string | null | undefined): void {
  try {
    const clean = String(token ?? "").trim();
    if (!SHARE_TOKEN_RE.test(clean)) return;
    if (!localStorage.getItem(SHARE_SOURCE_KEY)) {
      localStorage.setItem(SHARE_SOURCE_KEY, clean);
    }
  } catch {
    // 静默失败
  }
}

/** 读取已归因的分享 token（无则 undefined，注册请求省略该字段） */
export function readShareSource(): string | undefined {
  try {
    const value = (localStorage.getItem(SHARE_SOURCE_KEY) ?? "").trim();
    return value ? value : undefined;
  } catch {
    return undefined;
  }
}
