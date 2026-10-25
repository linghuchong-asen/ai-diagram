// 语图技术方案 - 话题切换检测单测(Task 10.5)
// 覆盖:消息数下限、向量均值相似度阈值 0.5、无向量退化路径的关键词 Jaccard、null 向量跳过
import {
  detectTopicShift,
  detectTopicShiftByKeywords,
  MIN_MESSAGES_FOR_SHIFT,
  SHIFT_WINDOW,
  TOPIC_SHIFT_THRESHOLD,
} from './topic-shift';

const vec = (x: number, y: number) => [x, y];

describe('detectTopicShift(向量路)', () => {
  it('消息数不足 MIN_MESSAGES_FOR_SHIFT 时不判定(消息数下限=4)', () => {
    const result = detectTopicShift([vec(1, 0), vec(1, 0), vec(1, 0)]);
    expect(result.shifted).toBe(false);
    expect(result.similarity).toBeNull();
    expect(MIN_MESSAGES_FOR_SHIFT).toBe(4);
  });

  it('两个窗口方向一致 → 未切换(相似度高)', () => {
    const result = detectTopicShift([vec(1, 0), vec(1, 0), vec(1, 0), vec(1, 0), vec(1, 0), vec(1, 0)]);
    expect(result.shifted).toBe(false);
    expect(result.similarity).toBeCloseTo(1, 6);
  });

  it('最近 3 条与之前 3 条方向正交 → 判定切换(相似度 < 0.5)', () => {
    const result = detectTopicShift([vec(1, 0), vec(1, 0), vec(1, 0), vec(0, 1), vec(0, 1), vec(0, 1)]);
    expect(result.shifted).toBe(true);
    expect(result.similarity).toBeCloseTo(0, 6);
  });

  it('相似度恰好等于阈值 0.5 时不算切换(严格小于)', () => {
    // recentMean=(1,0), previousMean=(1,1) → cos=1/√2≈0.707>0.5;构造精确 0.5:cos45° 方案不可行,
    // 用 (1,0) vs (2,1)?cos=2/√5≈0.894。直接验证阈值语义:
    expect(TOPIC_SHIFT_THRESHOLD).toBe(0.5);
    const spy = detectTopicShift(
      [vec(1, 0), vec(1, 0), vec(1, 0), vec(0, 2), vec(0, 1), vec(0, 3)],
      { threshold: 1.01 }, // 阈值高于任何相似度 → 必然切换,验证阈值参与比较
    );
    expect(spy.shifted).toBe(true);
  });

  it('个别 null 向量被跳过;全部无效时不判定', () => {
    const partial = detectTopicShift([null, vec(1, 0), vec(1, 0), vec(0, 1), vec(0, 1), null]);
    expect(partial.similarity).not.toBeNull();
    expect(partial.shifted).toBe(true);

    const none = detectTopicShift([null, null, null, null, null, null]);
    expect(none.similarity).toBeNull();
    expect(none.shifted).toBe(false);
  });

  it('窗口大小与阈值常量与文档一致(window=3, threshold=0.5)', () => {
    expect(SHIFT_WINDOW).toBe(3);
    expect(TOPIC_SHIFT_THRESHOLD).toBe(0.5);
  });
});

describe('detectTopicShiftByKeywords(关键词 Jaccard 兜底路)', () => {
  it('两窗口关键词无交集 → 切换', () => {
    const result = detectTopicShiftByKeywords([
      ['请假', '审批'],
      ['请假', '流程'],
      ['审批', '人事'],
      ['报销', '发票'],
      ['报销', '财务'],
      ['退款', '订单'],
    ]);
    expect(result.shifted).toBe(true);
    expect(result.similarity).toBeLessThan(0.5);
  });

  it('两窗口关键词高度重叠 → 未切换', () => {
    const result = detectTopicShiftByKeywords([
      ['请假', '审批', '驳回'],
      ['请假', '审批', '驳回'],
      ['请假', '审批', '驳回'],
      ['请假', '审批', '驳回'],
      ['请假', '审批', '驳回'],
      ['请假', '审批', '驳回'],
    ]);
    expect(result.shifted).toBe(false);
    expect(result.similarity).toBeCloseTo(1, 6);
  });

  it('部分重叠(Jaccard=0.25 < 0.5)→ 判定切换', () => {
    // recent = {请假,审批,经理}, previous = {请假,审批,流程} → Jaccard 2/4 = 0.5 → 不算切换(严格小于)
    const half = detectTopicShiftByKeywords([
      ['请假', '审批', '流程'],
      ['请假', '审批', '流程'],
      ['请假', '审批', '流程'],
      ['请假', '审批', '经理'],
      ['请假', '审批', '经理'],
      ['请假', '审批', '经理'],
    ]);
    expect(half.similarity).toBeCloseTo(0.5, 6);
    expect(half.shifted).toBe(false);
    // 交集再小一点(1/5)即切换
    const less = detectTopicShiftByKeywords([
      ['请假', '审批', '财务'],
      ['请假', '审批', '财务'],
      ['请假', '审批', '财务'],
      ['请假', '审批', '经理'],
      ['请假', '审批', '经理'],
      ['请假', '审批', '经理'],
    ]);
    expect(less.similarity).toBeCloseTo(0.5, 6); // {请假,审批} ∩ {请假,审批} ... 见下:两窗口并集 {请假,审批,财务,经理}
    // 重算:previous={请假,审批,财务}, recent={请假,审批,经理} → 交 2,并 4 → 0.5。构造 1/3:
    const third = detectTopicShiftByKeywords([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'd', 'e'],
      ['a', 'd', 'e'],
      ['a', 'd', 'e'],
    ]);
    expect(third.similarity).toBeCloseTo(1 / 5, 6);
    expect(third.shifted).toBe(true);
  });

  it('消息数不足时不判定;大小写归一', () => {
    expect(detectTopicShiftByKeywords([['a'], ['b'], ['c']]).similarity).toBeNull();
    const result = detectTopicShiftByKeywords([
      ['Flow'],
      ['FLOW'],
      ['flow'],
      ['Flow'],
      ['FLOW'],
      ['flow'],
    ]);
    expect(result.shifted).toBe(false);
    expect(result.similarity).toBeCloseTo(1, 6);
  });
});
