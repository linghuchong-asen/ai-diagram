/*
 * @Description: 免登录只读分享链接接口（V1.1 增长回路核心）
 *   GET    /share/view/:token        公开读取（无需登录，访客查看用）
 *   POST   /share/project/:id        创建分享（幂等，登录态，预览页/编辑器调用）
 *   POST   /share/duplicate/:token   复制分享为我的项目（登录态，快赢批次一 QW2）
 *   POST   /growth/track             前端增长事件上报（公开，事件白名单，快赢批次一 QW1）
 */

import { useMutation, useQuery } from "react-query";
import { useNormalQueryOptions } from "../../utils/hooks/useQueryOptions";
import { http, onErrorTips } from "../../utils/http";
import { fromjsonData } from "../preView";

/** 公开读取回传：项目名 + 画布 JSON（后端刻意最小化，不含归属信息） */
export interface ShareViewData {
  projectName: string;
  editorData: fromjsonData[];
  /** 免费档解锁标记：true=已解锁（项目已付费或归属人会员在期），展示不带水印；字段未到位时按 undefined 防御式处理 */
  unlocked?: boolean;
  /** 商业化闭环批次：仅当访问者（带登录态）就是项目归属人时回传，owner 可直达解锁动线；访客不回传 */
  isOwner?: boolean;
  /** 商业化闭环批次：仅 isOwner=true 时回传项目 id（跳转 /preview/:id 用） */
  projectId?: string;
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

/** 复制分享为我的项目（快赢批次一 QW2）：返回新项目 id/名称，页面跳编辑器继续改 */
export const duplicateShare = async (token: string) => {
  const response = await http<{ projectId: string; projectName: string }>(
    `/share/duplicate/${token}`,
    { method: "post" }
  );
  return response.data;
};

/**
 * 前端增长事件上报（快赢批次一 QW1）：分享页 CTA/模板点击等访客侧动作。
 * 用 sendBeacon/keepalive 发送，失败静默 —— 埋点绝不阻塞跳转与主流程。
 * 事件名需与后端 growth-track.controller 白名单一致。
 */
export function trackGrowthEvent(event: string, extra: Record<string, unknown> = {}): void {
  try {
    const payload = JSON.stringify({ event, ...extra });
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      navigator.sendBeacon("/api/growth/track", new Blob([payload], { type: "application/json" }));
      return;
    }
    void fetch("/api/growth/track", {
      method: "post",
      headers: { "Content-Type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // 序列化失败等极端情况：静默
  }
}
