// 语图增长方案 - 免登录单次试用：匿名试用身份与试用草稿的本地存取
// 试用链路（POST /api/ai/trial/chat）以 trialId 作为匿名身份标识（localStorage 持久化），
// 服务端按 trialId/IP/全局三层台账限制匿名用量；注册登录后由账号体系接管，本文件不感知登录态。

/** 匿名试用身份的 localStorage key */
const TRIAL_ID_KEY = 'yutu_trial_id';

/** 试用草稿（应用到画布后暂存，注册登录后在编辑器内无缝继承）的 localStorage key */
export const TRIAL_DRAFT_KEY = 'yutu_trial_draft';

/** 试用草稿结构：editorData 为 X6 cells 数组（与项目保存格式一致，可直接 graph.fromJSON） */
export interface TrialDraft {
  editorData: unknown[];
  projectName: string;
  prompt: string;
  ts: number;
}

/**
 * 读取（或首次生成）匿名试用 id。
 * crypto.randomUUID 优先（后端 schema 上限 64 字），不可用时降级为「时间戳+随机串」。
 */
export function getTrialId(): string {
  const fallback = () => `t-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  try {
    const existing = localStorage.getItem(TRIAL_ID_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : fallback();
    localStorage.setItem(TRIAL_ID_KEY, id);
    return id;
  } catch {
    // localStorage 不可用（隐私模式等）：退化为当次会话内随机 id，保证请求可发
    return fallback();
  }
}

/** 读取试用草稿（无草稿 / 结构不合法返回 null） */
export function readTrialDraft(): TrialDraft | null {
  try {
    const raw = localStorage.getItem(TRIAL_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as TrialDraft;
    if (!parsed || !Array.isArray(parsed.editorData)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写入试用草稿（试用页「应用到画布」成功后调用） */
export function saveTrialDraft(draft: TrialDraft): void {
  try {
    localStorage.setItem(TRIAL_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // 存储失败静默：注册继承是增强体验，不阻断主流程
  }
}

/** 清除试用草稿（编辑器成功继承后调用） */
export function clearTrialDraft(): void {
  try {
    localStorage.removeItem(TRIAL_DRAFT_KEY);
  } catch {
    // 忽略：无法清理不影响主流程
  }
}
