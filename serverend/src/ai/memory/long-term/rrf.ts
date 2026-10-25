// 语图技术方案 - RRF(Reciprocal Rank Fusion)融合
// 文档:双路召回(关键词路 + 向量路)各自排序后按 RRF 融合取 top-10,再交给 Reranker 取 top-3。
//   score(d) = Σ_i 1 / (k + rank_i(d)),k 默认 60。
// 特性:
//   - 纯函数,便于单测;
//   - 支持"单路退化":某一路不可用(如无 embedding)时只传单路列表,结果即该路排序;
//   - 未出现在某一路的文档,该路不贡献分数(而非给予惩罚性巨大 rank),避免单路退化时引入偏移;
//   - 排序稳定:分数相同按 id 字典序,保证多次调用结果一致。

export const DEFAULT_RRF_K = 60;
export const RRF_FUSION_TOP_N = 10; // 文档:融合后取 top-10 交给重排
export const RERANK_TOP_N = 3; // 文档:重排后取 top-3 注入上下文

export interface RankedItem {
  id: string;
  /** 该路原始分数(仅用于日志/调试,RRF 只使用排名) */
  score?: number;
}

export interface RrfEntry {
  id: string;
  score: number;
  /** 各路中的排名(0-based);未出现的路为 -1 */
  ranks: number[];
}

export interface FuseOptions {
  k?: number;
  topN?: number;
}

/**
 * 融合多路有序候选列表。
 * @param lists 每一路按相关性降序排列的候选(可为空数组,表示该路退化不可用)
 */
export function fuseRankedLists(lists: RankedItem[][], options: FuseOptions = {}): RrfEntry[] {
  const k = options.k ?? DEFAULT_RRF_K;
  const safeLists = (lists ?? []).filter((list) => Array.isArray(list));

  const acc = new Map<string, RrfEntry>();

  safeLists.forEach((list) => {
    const seen = new Set<string>();
    list.forEach((item, index) => {
      const id = item?.id;
      if (!id || seen.has(id)) return; // 同一路内去重,取首次出现的排名
      seen.add(id);

      let entry = acc.get(id);
      if (!entry) {
        entry = { id, score: 0, ranks: new Array<number>(safeLists.length).fill(-1) };
        acc.set(id, entry);
      }
      entry.ranks[index] = index;
      entry.score += 1 / (k + index + 1); // 排名从 1 开始计
    });
  });

  const result = [...acc.values()].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  return options.topN && options.topN > 0 ? result.slice(0, options.topN) : result;
}

/** 便捷方法:仅返回融合后的 id 序列 */
export function fuseToIds(lists: RankedItem[][], options: FuseOptions = {}): string[] {
  return fuseRankedLists(lists, options).map((e) => e.id);
}
