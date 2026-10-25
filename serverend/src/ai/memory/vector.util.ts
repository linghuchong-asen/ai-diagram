// 语图技术方案 - 向量工具(余弦相似度 / 向量均值)
// 文档:双路检索的向量路使用余弦相似度;话题切换检测使用"最近 N 条向量均值"与"之前 N 条向量均值"的相似度。
// 说明:当前环境无 pgvector,向量以 jsonb 存储,取有界候选集后在 JS 内计算相似度。

/** 余弦相似度:维度不一致或零向量返回 0 */
export function cosineSimilarity(a?: number[] | null, b?: number[] | null): number {
  if (!a || !b) return 0;
  if (a.length === 0 || a.length !== b.length) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

/** 多个向量的逐维均值(用于话题切换检测的"窗口向量"),无有效向量时返回 null */
export function meanVector(vectors: Array<number[] | null | undefined>): number[] | null {
  const valid = (vectors ?? []).filter((v): v is number[] => Array.isArray(v) && v.length > 0);
  if (valid.length === 0) return null;

  const dim = valid[0].length;
  const sums = new Array<number>(dim).fill(0);
  let used = 0;
  for (const vec of valid) {
    if (vec.length !== dim) continue;
    for (let i = 0; i < dim; i++) sums[i] += Number(vec[i]) || 0;
    used++;
  }
  if (used === 0) return null;
  return sums.map((s) => s / used);
}
