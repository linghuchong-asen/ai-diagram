/*
 * @Description: 思维体质图 · 原型映射纯函数（Round E · 魔性传播 A4）
 * MBTI 机制的合规化改造：不测「命运/性格对错」，产出物是「思维画像流程图」工具 ——
 * 答题结果仅决定生成哪种思维结构的图（决策树/放射/泳道/环路），无对错无预测，
 * 避开微信「测试类 H5」违规类目与算命式文案红线。
 * 本文件保持纯函数（无 React/无 DOM），便于断言脚本覆盖。
 */

/** 四种思维原型 key（决定生成图的拓扑结构） */
export type ArchetypeKey = 'decision' | 'radial' | 'lane' | 'loop';

/** 原型文案包（结果页展示 + 生成 prompt） */
export interface ArchetypeProfile {
  key: ArchetypeKey;
  name: string;
  tagline: string;
  description: string;
  /** 喂给 /trial?q= 的画像图生成指令（按拓扑结构定制，保证引擎画出对应形态） */
  prompt: string;
}

/** 原型档案（key 与 ArchetypeKey 一一对应） */
export const ARCHETYPES: Record<ArchetypeKey, ArchetypeProfile> = {
  decision: {
    key: 'decision',
    name: '决策树型头脑',
    tagline: '先问值不值，再问怎么做',
    description: '你天然用条件分支理解世界：任何事先找判断点，把可能性拆成二叉树再逐一排查。适合做风控、评审、架构选型。',
    prompt:
      '画一张「决策树型头脑」的思维画像流程图：接到任务先判断是否重要，重要则判断是否紧急，紧急则立刻拆解执行，不紧急则排入计划；不重要则判断是否有风险，有风险则记录备忘，无风险则果断放弃；每个分支最终都汇入复盘节点',
  },
  radial: {
    key: 'radial',
    name: '放射型头脑',
    tagline: '从一个点，炸出一片星空',
    description: '你从一个想法能瞬间联想到十个方向：头脑风暴、起名、找选题是你的主场。注意给发散装上收敛的刹车。',
    prompt:
      '画一张「放射型头脑」的思维画像流程图：中心是「一个想法」，向四周放射出六个分支：联想到的相似案例、相反的观点、可组合的元素、放大的版本、缩小的版本、完全无关的脑洞，每个分支末端再各接一个「能否落地」判断节点，最后全部汇入「筛选收敛」',
  },
  lane: {
    key: 'lane',
    name: '泳道型头脑',
    tagline: '谁的事，归谁的道',
    description: '你本能地把混乱拆成角色与阶段：谁在什么时候做什么。会议纪要、SOP、协作流程经你手必然清晰。',
    prompt:
      '画一张「泳道型头脑」的思维画像流程图：按「我」「协作方」「外部环境」三条泳道组织，我提出方案并拆解任务，协作方并行评估与反馈，外部环境提供约束条件，三方节点按时间顺序交叉推进，最终在汇合点交付并复盘',
  },
  loop: {
    key: 'loop',
    name: '环路型头脑',
    tagline: '没有终点，只有下一轮',
    description: '你信奉迭代：先做个最小版本，跑一轮看反馈再改。产品、科研、健身增肌都是你的循环系统。',
    prompt:
      '画一张「环路型头脑」的思维画像流程图：制定最小目标 → 快速执行一轮 → 收集反馈 → 判断是否达标，未达标则调整策略回到执行（形成循环），达标则升级目标进入下一轮循环，循环之间由「复盘沉淀」节点衔接',
  },
};

/** 题目：5 道情境单选，每题 4 个选项分别倾向一种原型（顺序固定，题目设计保证四种倾向均衡出现） */
export interface MindQuestion {
  id: number;
  text: string;
  options: Array<{ label: string; tendency: ArchetypeKey }>;
}

export const MIND_QUESTIONS: MindQuestion[] = [
  {
    id: 1,
    text: '朋友丢给你一个模糊的点子「我们搞个副业吧」，你的第一反应是？',
    options: [
      { label: '先判断：投入多少、回报多少、值不值得做', tendency: 'decision' },
      { label: '瞬间冒出十个方向：带货？社群？工具？周边？', tendency: 'radial' },
      { label: '开始分工：我做什么、你做什么、找谁帮忙', tendency: 'lane' },
      { label: '先做个最小版本卖一次试试水', tendency: 'loop' },
    ],
  },
  {
    id: 2,
    text: '收拾一间乱成一团的房间，你会？',
    options: [
      { label: '制定取舍标准：常用的留、不用的扔', tendency: 'decision' },
      { label: '顺便重新设计整个房间的布局', tendency: 'radial' },
      { label: '按区域划分：衣柜区、书桌区、杂物区逐区清', tendency: 'lane' },
      { label: '先收拾 15 分钟看看效果，再决定下一轮怎么收', tendency: 'loop' },
    ],
  },
  {
    id: 3,
    text: '看一部悬疑片，你在意的是？',
    options: [
      { label: '每个关键岔口：如果当时选了另一条路呢', tendency: 'decision' },
      { label: '各种脑洞：凶手会不会是编剧根本没拍的人', tendency: 'radial' },
      { label: '人物关系网：谁负责什么、谁隐瞒了什么', tendency: 'lane' },
      { label: '反转结构：这个包袱是从哪一轮铺垫开始埋的', tendency: 'loop' },
    ],
  },
  {
    id: 4,
    text: '接到一个从没做过的任务，你会？',
    options: [
      { label: '列出做/不做的判断依据，逐条评估', tendency: 'decision' },
      { label: '先查这个任务能延伸出的所有可能玩法', tendency: 'radial' },
      { label: '画出任务流程：前置条件、执行步骤、交付标准', tendency: 'lane' },
      { label: '直接做出第一版，烂也比空想强', tendency: 'loop' },
    ],
  },
  {
    id: 5,
    text: '你的笔记/待办清单长什么样？',
    options: [
      { label: '按优先级和条件分支组织的清单', tendency: 'decision' },
      { label: '一张发散的思维导图，到处都是连线', tendency: 'radial' },
      { label: '按项目/角色分组，每组一条时间线', tendency: 'lane' },
      { label: '周复盘循环：本周尝试→效果→下周调整', tendency: 'loop' },
    ],
  },
];

/**
 * 由答案计算思维原型。
 * 入参：每题所选选项的下标数组（0-3，长度与题目数一致，未答视为 -1 跳过）。
 * 规则：计点制，平票时按 decision > radial > lane > loop 的固定顺序取先者（确定性输出，
 * 保证同答案必同结果）；全部未答 → decision（页面会校验至少答一题，此处兜底）。
 */
export function computeArchetype(choices: number[]): ArchetypeProfile {
  const scores: Record<ArchetypeKey, number> = { decision: 0, radial: 0, lane: 0, loop: 0 };
  MIND_QUESTIONS.forEach((question, index) => {
    const choice = choices[index];
    if (typeof choice !== 'number' || choice < 0 || choice >= question.options.length) return;
    const tendency = question.options[choice].tendency;
    scores[tendency] += 1;
  });
  // 固定顺序遍历取最大值：平票时先者胜（确定性）
  const order: ArchetypeKey[] = ['decision', 'radial', 'lane', 'loop'];
  let winner: ArchetypeKey = 'decision';
  for (const key of order) {
    if (scores[key] > scores[winner]) winner = key;
  }
  return ARCHETYPES[winner];
}

/** 答题完成度：已答题数（用于页面校验与进度显示） */
export function answeredCount(choices: number[]): number {
  return choices.filter((choice) => typeof choice === 'number' && choice >= 0).length;
}
