// 语图技术方案 - 会话内产物版本历史栈（competitor-driven-evolution-batch Round 11）
// 背景：版本历史是 Whimsical/OpenDiagram 路线图的标配;AI 生成天然多版本(重试/改形态),
//       用户「觉得上一版更好」时无处可回。本轮做会话内的轻量版本栈(不上库,组件态)。
// 原则:纯函数、不可变(每次返回新状态)、上限防膨胀;cursor 指向当前查看版本(新版本会使 cursor 复位到最新)。
import type { AiResult } from '../../../utils/aiClient';
import { ARTIFACT_KIND_LABEL } from '../artifacts/artifact-meta';

/** 历史上限:会话内 20 版足够回溯,超出丢弃最旧(与本地草稿箱上限一致) */
export const HISTORY_LIMIT = 20;

export interface HistoryEntry {
  id: string;
  /** 展示标签(如「思维导图 · 第 3 版」) */
  label: string;
  /** 记录时间(epoch ms) */
  at: number;
  /** 版本内容(generate 结果本体) */
  payload: AiResult;
}

export interface HistoryState {
  entries: HistoryEntry[];
  /** 当前查看的下标(0 基;push 后复位到最新) */
  cursor: number;
}

export function createHistory(): HistoryState {
  return { entries: [], cursor: -1 };
}

/** 记录一个新版本:cursor 复位到最新;超上限丢最旧 */
export function pushHistory(state: HistoryState, payload: AiResult, label: string, at: number, id: string): HistoryState {
  const entry: HistoryEntry = { id, label, at, payload };
  const entries = [...state.entries, entry];
  const trimmed = entries.length > HISTORY_LIMIT ? entries.slice(entries.length - HISTORY_LIMIT) : entries;
  return { entries: trimmed, cursor: trimmed.length - 1 };
}

/** 版本标签:形态中文名 + 第 N 版 */
export function historyLabelFor(result: AiResult, version: number): string {
  const kind = result.kind === 'generate' ? (result.artifactKind ?? 'flowchart') : result.kind;
  const base = ARTIFACT_KIND_LABEL[kind as keyof typeof ARTIFACT_KIND_LABEL] ?? String(kind);
  return `${base} · 第 ${version} 版`;
}

/** 游标步进(±1,夹紧到 [0, length-1];越界返回原状态引用便于相等性短路) */
export function stepHistory(state: HistoryState, delta: number): HistoryState {
  if (state.entries.length === 0) return state;
  const next = Math.max(0, Math.min(state.entries.length - 1, state.cursor + delta));
  if (next === state.cursor) return state;
  return { ...state, cursor: next };
}

/** 当前查看的版本 */
export function historyCurrent(state: HistoryState): HistoryEntry | undefined {
  return state.entries[state.cursor];
}
