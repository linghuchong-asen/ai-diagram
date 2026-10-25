// 语图技术方案 - RRF 融合单测(Task 10.2)
// 覆盖:score = Σ 1/(k + rank) 公式语义、单路退化、同路去重、稳定性(同分按 id 字典序)、topN 截断
import { DEFAULT_RRF_K, fuseRankedLists, fuseToIds, RRF_FUSION_TOP_N, RERANK_TOP_N } from './rrf';

const item = (id: string, score?: number) => ({ id, score });

describe('fuseRankedLists', () => {
  it('两路都命中的文档得分高于单路命中的文档', () => {
    const fused = fuseRankedLists([[item('a'), item('b')], [item('b'), item('c')]]);
    expect(fused[0].id).toBe('b'); // a,b 单路分相同(1/(60+1)),b 两路累加 → 第一
    expect(fused.map((e) => e.id)).toEqual(['b', 'a', 'c']);
  });

  it('排名越靠前贡献越大:1/(k+1) > 1/(k+2)', () => {
    const fused = fuseRankedLists([[item('x'), item('y')]]);
    expect(fused[0].score).toBeCloseTo(1 / (DEFAULT_RRF_K + 1), 10);
    expect(fused[1].score).toBeCloseTo(1 / (DEFAULT_RRF_K + 2), 10);
  });

  it('单路退化:空路不参与融合,结果即另一路排序', () => {
    const fused = fuseRankedLists([[], [item('m'), item('n')]]);
    expect(fused.map((e) => e.id)).toEqual(['m', 'n']);
  });

  it('全空输入返回空列表(不抛错)', () => {
    expect(fuseRankedLists([])).toEqual([]);
    expect(fuseRankedLists([[], []])).toEqual([]);
  });

  it('同一路内重复 id 去重,取首次出现排名', () => {
    const fused = fuseRankedLists([[item('dup'), item('dup'), item('other')]]);
    expect(fused).toHaveLength(2);
    expect(fused[0].id).toBe('dup');
  });

  it('排序稳定:同分(不同路同排名)按 id 字典序', () => {
    // 两路各自的第 1 名 → RRF 分数同为 1/(k+1),平分时按 id 字典序
    const fused = fuseRankedLists([[item('zz')], [item('aa')]]);
    expect(fused.map((e) => e.id)).toEqual(['aa', 'zz']);
  });

  it('topN 截断:融合 top-10 → 重排 top-3 的常量约定', () => {
    const list = Array.from({ length: 20 }, (_, i) => item(`id-${String(i).padStart(2, '0')}`)).reverse();
    const fused = fuseRankedLists([list], { topN: RRF_FUSION_TOP_N });
    expect(fused).toHaveLength(RRF_FUSION_TOP_N);
    expect(fused[0].id).toBe('id-19');
    expect(RERANK_TOP_N).toBe(3);
  });

  it('fuseToIds 只返回 id 序列(名次优先于路数:a/c 同为第 1 名并列前二)', () => {
    // a=第1名(路1)=1/61,c=第1名(路2)=1/61 > b=第2名=1/62;平分按字典序 a<c
    expect(fuseToIds([[item('a'), item('b')], [item('c')]])).toEqual(['a', 'c', 'b']);
  });
});
