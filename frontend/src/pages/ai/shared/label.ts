// 语图技术方案 - 前端 AI 模块共享「标签归一化」工具
// 对应 .trae/specs/align-yutu-doc-and-code/spec.md「四级降级匹配 - L2 语义匹配」与
//      Task 2.3「新节点相对定位（按 label 找参照节点）」两处共同需求，抽为共享模块避免重复实现。
// 纯函数、无副作用。

/** 归一化：去首尾空白 + 折叠内部连续空白 + 小写 + 去掉常见全角/半角标点差异 */
export function normalizeLabel(label: unknown): string {
  if (typeof label !== 'string') return '';
  return label
    .replace(/\s+/g, '')
    .replace(/[\u3000]/g, '')
    .replace(/[，。、；：！？（）【】“”‘’]/g, (ch) => PUNCT_MAP[ch] ?? ch)
    .toLowerCase();
}

const PUNCT_MAP: Record<string, string> = {
  '，': ',',
  '。': '.',
  '、': ',',
  '；': ';',
  '：': ':',
  '！': '!',
  '？': '?',
  '（': '(',
  '）': ')',
  '【': '[',
  '】': ']',
  '“': '"',
  '”': '"',
  '‘': "'",
  '’': "'",
};

/** 两个标签是否语义等价（归一化后相等；空标签互不相等） */
export function labelEquals(a: unknown, b: unknown): boolean {
  const na = normalizeLabel(a);
  const nb = normalizeLabel(b);
  if (na.length === 0 || nb.length === 0) return false;
  return na === nb;
}
