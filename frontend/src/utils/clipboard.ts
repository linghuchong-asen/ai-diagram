/*
 * @Description: 剪贴板复制工具（V1.1 分享链接使用）
 * 优先 Clipboard API（HTTPS / localhost），失败降级 execCommand（兼容 HTTP 环境副本）。
 */

export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 非安全上下文（HTTP）或权限拒绝 → 走降级方案
  }
  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    // 移出可视区避免页面抖动
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}
