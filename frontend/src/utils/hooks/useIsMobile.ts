/*
 * @Description: 窄屏（移动端）判定 hook
 * 断点 768px 与 tech-theme.css 的 @media 断点保持一致，供组件做行为分支
 * （如编辑器隐藏图形库、AI 浮窗切全屏对话模式）。
 * 移动端产品策略：只读 + AI 对话生成为主，画布拖拽编辑降级（详见 docs/launch）。
 */

import { useEffect, useState } from 'react';

/** 窄屏断点（px）：与 tech-theme.css 移动端媒体查询保持一致 */
export const MOBILE_BREAKPOINT = 768;

export const useIsMobile = (): boolean => {
  const [isMobile, setIsMobile] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.innerWidth <= MOBILE_BREAKPOINT : false,
  );

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);
    const onChange = () => setIsMobile(mq.matches);
    // 挂载时同步一次，响应断点变化（旋转屏幕 / 拖拽窗口）
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  return isMobile;
};
