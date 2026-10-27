/*
 * @Description: 模板中心接口（Task 7）
 *   GET /template/list  公开读取预置模板列表（无需登录，仅 IP 限流）
 * 模板为后端静态预置数据（无搜索无分页），点击模板携带 prompt 跳 /trial 试用页。
 * competitor-driven-evolution-batch Round 18：新增「多形态」分类——四形态模板带
 *   formHint（点击后拼 /trial?q=...&form=table 直达产物形态，FormRouter formHint 直通）。
 */

import { useMutation, useQuery } from "react-query";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http, onErrorTips } from "../../utils/http";

/** 模板分类（与后端枚举一致） */
export type TemplateCategory = "校园" | "职场" | "电商" | "研发" | "多形态";

/** 多形态模板的产物形态提示（与后端 TemplateFormHint 契约一致） */
export type TemplateFormHint = "mindmap" | "table" | "checklist" | "timeline";

/** 模板条目（后端契约）：prompt 可直接作为 AI 生成指令 */
export interface FlowTemplate {
  id: string;
  name: string;
  category: TemplateCategory;
  /** 短标签（如「论文答辩」） */
  scene: string;
  /** 一句话场景说明（给用户看） */
  description: string;
  /** 可直接喂 AI 的完整流程描述 */
  prompt: string;
  /** 产物形态提示（Round 18,仅「多形态」分类模板携带） */
  formHint?: TemplateFormHint;
}

interface TemplatesProp {
  data: FlowTemplate[];
}

/** 拉取模板列表：失败不重试（页面统一渲染失败态） */
export const useGetTemplates = () => {
  return useQuery<TemplatesProp>(
    ["useGetTemplates"],
    () => http<FlowTemplate[]>("/template/list"),
    useNormalQueryOptions({ retry: false })
  );
};

/* ===== 社区模板（community-template-batch）：用户作品投稿 → 审核上架 ===== */

/** 社区精选条目（后端契约）：shareToken 指向 /share/:token 免登录成品页 */
export interface CommunityTemplateItem {
  id: string;
  title: string;
  description: string;
  ownerName: string;
  shareToken: string;
  /** 热度（模板使用统计批次）：成品页查看数 / 被复制数 */
  viewCount?: number;
  copyCount?: number;
}

interface CommunityTemplatesProp {
  data: CommunityTemplateItem[];
}

/** 社区精选（公开）：仅已上架，倒序 ≤24 条；失败不重试（分区降级为空态） */
export const useGetCommunityTemplates = () => {
  return useQuery<CommunityTemplatesProp>(
    ["useGetCommunityTemplates"],
    () => http(`/template/community`),
    useNormalQueryOptions({ retry: false })
  );
};

/** 投稿社区模板（登录态 + 归属校验，服务端定价无金额）：描述选填 */
export const useSubmitCommunityTemplate = () => {
  return useMutation(
    (params: { projectId: string; description?: string }) =>
      http(`/template/submit/${params.projectId}`, {
        method: "post",
        params: params.description ? { description: params.description } : undefined,
      }),
    { onError: onErrorTips }
  );
};
