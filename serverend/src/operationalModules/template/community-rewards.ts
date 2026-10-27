// 语图投稿激励批次 - 社区模板复制里程碑常量与领取记录实体
// 规则（与 growth 一页纸「社区模板」口径一致）：
//   - 投稿作品每被完整复制（share_duplicate）跨过档位：投稿人会员有效期一次性加送；
//   - 档位：被复制 5 次 → +1 天；被复制 20 次 → +3 天（改本常量即调档）；
//   - 领取记录 (userId, milestone) 唯一，INSERT ON CONFLICT DO NOTHING 抢占防并发重复发放；
//   - 全程旁路：发放失败只留痕，绝不影响复制主链路。

/** 社区模板复制里程碑档位（count = 累计被复制次数，days = 加送会员天数） */
export const COMMUNITY_COPY_MILESTONES: ReadonlyArray<{ count: number; days: number }> = [
  { count: 5, days: 1 },
  { count: 20, days: 3 },
];
