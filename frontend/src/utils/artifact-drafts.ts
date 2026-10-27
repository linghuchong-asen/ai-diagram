// 语图技术方案 - 本地草稿箱（competitor-driven-evolution-batch Round 12）
// 背景：产物历史分两层——R11 版本栈是「会话内」组件态;本文件是「跨会话」本地持久化
//       （localStorage,最近 20 条）。对标 Excalidraw「免注册也有本地场景」的零门槛哲学。
// 设计：
//   ① 存储操作注入 DraftStorageLike（localStorage 的最小接口）——纯逻辑可在 Node 断言环境测试;
//   ② 损坏容错：JSON 解析失败/结构非法 → 重置为空,绝不抛异常;
//   ③ 上限 20 条,新的在前;配额超限(setItem 抛错)按保存失败返回 null。
import type { AiResult, ArtifactKind } from './aiClient';

/** localStorage 的最小结构接口(测试用内存桩实现同一契约) */
export interface DraftStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const ARTIFACT_DRAFTS_KEY = 'yutu_artifact_drafts_v1';
/** 草稿上限(与版本栈 HISTORY_LIMIT 对齐) */
export const ARTIFACT_DRAFTS_LIMIT = 20;

const KINDS: ArtifactKind[] = ['flowchart', 'mindmap', 'table', 'checklist', 'timeline'];

export interface ArtifactDraft {
  id: string;
  kind: ArtifactKind;
  /** 保存时间(epoch ms) */
  at: number;
  /** 产物本体(generate 结果) */
  payload: AiResult;
}

/** 草稿结构校验(损坏容错的第一道闸:非法条目直接过滤,不影响其他条目) */
function isValidDraft(value: unknown): value is ArtifactDraft {
  if (!value || typeof value !== 'object') return false;
  const draft = value as { id?: unknown; kind?: unknown; at?: unknown; payload?: unknown };
  if (typeof draft.id !== 'string' || !draft.id) return false;
  if (typeof draft.at !== 'number' || !Number.isFinite(draft.at)) return false;
  if (typeof draft.kind !== 'string' || !KINDS.includes(draft.kind as ArtifactKind)) return false;
  const payload = draft.payload as { kind?: unknown } | null;
  if (!payload || payload.kind !== 'generate') return false;
  // payload 与形态配对校验(与后端 superRefine 同款契约)
  const fieldByKind: Record<string, unknown> = payload as Record<string, unknown>;
  const required = draft.kind === 'flowchart' ? 'flowDraft' : `${draft.kind}Draft`;
  return !!fieldByKind[required];
}

/** 从存储读取草稿列表(损坏/越界一律容错) */
export function loadDraftsFrom(store: DraftStorageLike | null): ArtifactDraft[] {
  if (!store) return [];
  try {
    const raw = store.getItem(ARTIFACT_DRAFTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidDraft).slice(0, ARTIFACT_DRAFTS_LIMIT);
  } catch {
    return [];
  }
}

/**
 * 保存草稿(新的在前,超限丢最旧)。
 * 仅接受 generate 结果且形态-payload 配对完整;存储不可用/配额超限返回 null(调用方静默)。
 */
export function saveDraftTo(store: DraftStorageLike | null, payload: AiResult, at: number = Date.now()): ArtifactDraft[] | null {
  if (!store) return null;
  const result = payload as { kind?: string; artifactKind?: ArtifactKind } | null;
  if (!result || result.kind !== 'generate') return null;
  const kind = result.artifactKind ?? 'flowchart';
  const probe = { ...result, artifactKind: kind } as unknown;
  if (!isValidDraft({ id: 'probe', kind, at, payload: probe as AiResult })) return null;

  const drafts = loadDraftsFrom(store);
  const entry: ArtifactDraft = { id: `d${at}-${drafts.length}`, kind, at, payload: result as AiResult };
  const next = [entry, ...drafts].slice(0, ARTIFACT_DRAFTS_LIMIT);
  try {
    store.setItem(ARTIFACT_DRAFTS_KEY, JSON.stringify(next));
    return next;
  } catch {
    // localStorage 配额满/隐私模式:保存失败不致命
    return null;
  }
}

/** 按 id 删除单条草稿 */
export function removeDraftFrom(store: DraftStorageLike | null, id: string): ArtifactDraft[] {
  const drafts = loadDraftsFrom(store);
  const next = drafts.filter((d) => d.id !== id);
  if (store) {
    try {
      store.setItem(ARTIFACT_DRAFTS_KEY, JSON.stringify(next));
    } catch {
      // 写回失败:内存视图仍返回删除后的列表
    }
  }
  return next;
}

/** 清空草稿箱 */
export function clearDraftsIn(store: DraftStorageLike | null): void {
  if (!store) return;
  try {
    store.removeItem(ARTIFACT_DRAFTS_KEY);
  } catch {
    // 容错
  }
}

// ---------------------------------------------------------------------------
// 公共入口(浏览器 localStorage;Node/隐私模式自动降级)
// ---------------------------------------------------------------------------

function browserStorage(): DraftStorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

/** 保存当前产物到本地草稿箱(浮窗 generate 结果落盘点调用) */
export function saveArtifactDraft(payload: AiResult, at: number = Date.now()): boolean {
  return saveDraftTo(browserStorage(), payload, at) !== null;
}

/** 读取本地草稿箱(跨会话回看) */
export function listArtifactDrafts(): ArtifactDraft[] {
  return loadDraftsFrom(browserStorage());
}

/** 删除单条草稿 */
export function removeArtifactDraft(id: string): ArtifactDraft[] {
  return removeDraftFrom(browserStorage(), id);
}

/** 清空草稿箱 */
export function clearArtifactDrafts(): void {
  clearDraftsIn(browserStorage());
}
