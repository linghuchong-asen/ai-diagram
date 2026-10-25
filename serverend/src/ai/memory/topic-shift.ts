// 语图技术方案 - 话题切换检测(Task 10.5)
// 文档(memory.md)伪代码:
//   if (messages.length < 4) return false;
//   recentMean = mean(vectors[-3:]); previousMean = mean(vectors[-6:-3]);
//   return cosine(recentMean, previousMean) < 0.5;
// 作用:检测到话题切换后调整短期记忆策略 —— 缩小近期原文窗口、更依赖滚动摘要,并 trim 旧话题原文。
import { cosineSimilarity, meanVector } from './vector.util';

export const MIN_MESSAGES_FOR_SHIFT = 4;
export const SHIFT_WINDOW = 3;
export const TOPIC_SHIFT_THRESHOLD = 0.5;

export interface TopicShiftResult {
  shifted: boolean;
  /** 两个窗口的相似度;向量不足时为 null */
  similarity: number | null;
  /** 无法判定的原因(消息不足 / 无向量) */
  reason?: string;
}

/**
 * 基于向量均值的话题切换检测。
 * @param vectors 按时间顺序排列的消息向量(允许个别为 null,会被跳过)
 */
export function detectTopicShift(
  vectors: Array<number[] | null | undefined>,
  options: { window?: number; threshold?: number; minMessages?: number } = {},
): TopicShiftResult {
  const win = options.window ?? SHIFT_WINDOW;
  const threshold = options.threshold ?? TOPIC_SHIFT_THRESHOLD;
  const minMessages = options.minMessages ?? MIN_MESSAGES_FOR_SHIFT;

  const list = vectors ?? [];
  if (list.length < minMessages) {
    return { shifted: false, similarity: null, reason: `消息数不足(${list.length}<${minMessages})` };
  }

  const recent = list.slice(-win);
  const previous = list.slice(-win * 2, -win);
  if (previous.length === 0) {
    return { shifted: false, similarity: null, reason: '历史窗口为空' };
  }

  const recentMean = meanVector(recent);
  const previousMean = meanVector(previous);
  if (!recentMean || !previousMean) {
    return { shifted: false, similarity: null, reason: '向量不可用,跳过话题切换检测' };
  }

  const similarity = cosineSimilarity(recentMean, previousMean);
  return { shifted: similarity < threshold, similarity };
}

/**
 * 无向量环境的文本兜底:用关键词集合的 Jaccard 相似度近似话题相似度。
 * 阈值同 0.5(相似度低于阈值判定切换)。仅在 embedding 不可用时使用。
 */
export function detectTopicShiftByKeywords(
  keywordSets: Array<string[] | null | undefined>,
  options: { window?: number; threshold?: number; minMessages?: number } = {},
): TopicShiftResult {
  const win = options.window ?? SHIFT_WINDOW;
  const threshold = options.threshold ?? TOPIC_SHIFT_THRESHOLD;
  const minMessages = options.minMessages ?? MIN_MESSAGES_FOR_SHIFT;

  const list = keywordSets ?? [];
  if (list.length < minMessages) {
    return { shifted: false, similarity: null, reason: `消息数不足(${list.length}<${minMessages})` };
  }

  const recent = union(list.slice(-win));
  const previous = union(list.slice(-win * 2, -win));
  if (recent.size === 0 || previous.size === 0) {
    return { shifted: false, similarity: null, reason: '关键词不可用,跳过话题切换检测' };
  }

  let intersection = 0;
  for (const k of recent) if (previous.has(k)) intersection++;
  const similarity = intersection / (recent.size + previous.size - intersection);
  return { shifted: similarity < threshold, similarity };
}

function union(sets: Array<string[] | null | undefined>): Set<string> {
  const out = new Set<string>();
  for (const s of sets ?? []) {
    for (const k of s ?? []) if (k) out.add(String(k).toLowerCase());
  }
  return out;
}
