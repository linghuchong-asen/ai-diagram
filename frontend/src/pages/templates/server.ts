/*
 * @Description: 模板中心接口（Task 7）
 *   GET /template/list  公开读取预置模板列表（无需登录，仅 IP 限流）
 * 模板为后端静态预置数据（无搜索无分页），点击模板携带 prompt 跳 /trial 试用页。
 */

import { useQuery } from "react-query";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http } from "../../utils/http";

/** 模板分类（与后端枚举一致） */
export type TemplateCategory = "校园" | "职场" | "电商" | "研发";

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
