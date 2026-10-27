/*
 * @Description: 文本文件读取工具（Round F · 一图看懂支持上传 txt/md）
 * 客户端 FileReader 读取纯文本文件填入 digest 输入区 —— 不经服务器上传，
 * 无网络往返、无隐私落盘（文件内容只在浏览器内存中流转）。
 * 防御边界：扩展名/类型白名单（.txt/.md/.markdown 或 text/*）+ 2MB 大小上限。
 */

/** 允许读取的扩展名白名单（小写比较） */
const ALLOWED_EXTENSIONS = ['.txt', '.md', '.markdown'];

/** 文件大小上限：2MB（足够容纳约百万字符的纯文本，远超 digest 用量） */
export const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;

/**
 * 读取纯文本文件内容。
 * 抛错（一律 Error，调用方统一提示）：
 *   - 扩展名/MIME 不在白名单 → 只接受 .txt / .md / .markdown；
 *   - 文件超过 2MB。
 */
export function readTextFile(file: File): Promise<string> {
  const name = String(file?.name ?? '').toLowerCase();
  const extensionAllowed = ALLOWED_EXTENSIONS.some((ext) => name.endsWith(ext));
  const mimeAllowed = String(file?.type ?? '').startsWith('text/');
  if (!extensionAllowed && !mimeAllowed) {
    return Promise.reject(new Error('只支持 .txt / .md / .markdown 纯文本文件'));
  }
  if (file.size > MAX_TEXT_FILE_BYTES) {
    return Promise.reject(new Error('文件超过 2MB 上限，请拆分后再试'));
  }
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('文件读取失败，请重试'));
    reader.readAsText(file);
  });
}

/**
 * 按上限截断文本（digest 匿名链路上限 500 字）。
 * 截断在字符边界进行（Array.from 按 Unicode 码位切，中文安全），
 * 返回 truncated 标记供调用方展示「已截断，注册后可处理更长」提示。
 */
export function clipToLimit(text: string, limit: number): { text: string; truncated: boolean } {
  const chars = Array.from(String(text ?? ''));
  if (chars.length <= limit) {
    return { text: chars.join(''), truncated: false };
  }
  return { text: chars.slice(0, limit).join(''), truncated: true };
}
