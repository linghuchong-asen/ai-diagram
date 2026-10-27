// 语图技术方案 - 产物追问建议（competitor-driven-evolution-batch Round 8）
// 背景：竞品普遍在生成后给 next-step 建议（避免「生成后冷场」）；Napkin 的多方案切换是标杆。
//       语图版：每种产物给 3 条跟进建议——2 条同形态深化 + 1 条跨形态转换（发挥 formHint 直通能力）。
// 原则:纯函数、静态规则(零 token、确定性);建议 prompt 会进入会话上下文,由记忆体系衔接。
import type { ArtifactKind } from '../../../utils/aiClient';

export interface FollowupSuggestion {
  /** 展示文案(短) */
  label: string;
  /** 点击即发送的完整 prompt */
  prompt: string;
  /** 跨形态建议携带 formHint(后端直通该形态,不依赖关键词路由) */
  formHint?: ArtifactKind;
}

/** 各形态的建议库:前两条同形态深化,第三条跨形态转换(对标「换个视角看同一问题」) */
const SUGGESTIONS: Record<ArtifactKind, FollowupSuggestion[]> = {
  flowchart: [
    { label: '补全异常分支', prompt: '为当前流程补充异常处理与驳回分支，让流程闭环。' },
    { label: '给出简化版', prompt: '当前流程哪些步骤可以合并或省略？给出简化后的版本。' },
    { label: '换导图总览', prompt: '把当前流程整理成思维导图，突出阶段与要点。', formHint: 'mindmap' },
  ],
  mindmap: [
    { label: '压缩收敛', prompt: '把这张思维导图压缩到 3 层以内，合并同类分支。' },
    { label: '挑出重点', prompt: '从这张导图中挑出最重要的 3 个分支，说明理由。' },
    { label: '转执行清单', prompt: '把这张导图里的可执行事项整理成分组清单。', formHint: 'checklist' },
  ],
  table: [
    { label: '加权打分', prompt: '按重要维度加权打分，给出推荐结论和理由。' },
    { label: '补充维度', prompt: '再补充 2 个我没考虑到的关键对比维度。' },
    { label: '排执行时间线', prompt: '把选定方案的执行步骤排成时间线。', formHint: 'timeline' },
  ],
  checklist: [
    { label: '按负责人重排', prompt: '把清单按负责人重新分组，标出每个人的待办。' },
    { label: '找关键路径', prompt: '哪些事项是关键路径？延误会影响整体进度的是哪几项？' },
    { label: '估算排期', prompt: '为每项估算耗时并排出时间线。', formHint: 'timeline' },
  ],
  timeline: [
    { label: '检查冲突', prompt: '检查当前时间线是否有冲突或过于紧凑的地方，给出调整建议。' },
    { label: '精简版本', prompt: '如果时间减半，如何取舍？给出精简版时间线。' },
    { label: '备物品清单', prompt: '按这份时间线整理一份出发前准备清单。', formHint: 'checklist' },
  ],
};

/**
 * 生成产物后的跟进建议(每形态 3 条:2 深化 + 1 跨形态)。
 * 逐项浅拷贝返回(数组与元素都不与内部库共享,防止调用方意外篡改建议库)。
 */
export function suggestFollowups(kind: ArtifactKind): FollowupSuggestion[] {
  return (SUGGESTIONS[kind] ?? SUGGESTIONS.flowchart).map((item) => ({ ...item }));
}
