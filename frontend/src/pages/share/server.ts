/*
 * @Description: 免登录只读分享链接接口（V1.1 增长回路核心）
 *   GET    /share/view/:token    公开读取（无需登录，访客查看用）
 *   POST   /share/project/:id    创建分享（幂等，登录态，预览页/编辑器调用）
 *   DELETE /share/project/:id   撤销分享（登录态）
 */

import { useMutation, useQuery } from "react-query";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http, onErrorTips } from "../../utils/http";
import { fromjsonData } from "../preView";

/** 公开读取回传：项目名 + 画布 JSON（后端刻意最小化，不含归属信息） */
export interface ShareViewData {
  projectName: string;
  editorData: fromjsonData[];
  /** 免费档解锁标记（后端并行开发中）：true=已解锁，展示不带水印；字段未到位时按 undefined 防御式处理 */
  unlocked?: boolean;
}

interface ShareViewProp {
  data: ShareViewData;
}

/** 访客免登录查看：404 由页面统一渲染「链接已失效」态 */
export const useGetShareView = (token: string | undefined) => {
  return useQuery<ShareViewProp>(
    ["useGetShareView", token],
    () => http(`/share/view/${token}`),
    useNormalQueryOptions({ enabled: token !== undefined, retry: false })
  );
};

/** 创建分享（幂等）：返回 token，前端拼 `${origin}/share/${token}` */
export const useCreateShare = () => {
  return useMutation(
    (projectId: string) =>
      http<{ shareToken: string }>(`/share/project/${projectId}`, {
        method: "post",
      }),
    { onError: onErrorTips }
  );
};
