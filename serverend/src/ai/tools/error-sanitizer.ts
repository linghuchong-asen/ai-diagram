// 语图技术方案 - 错误结构化脱敏
// 目标:原始堆栈 / 数据库连接串 / 内部 IP / 绝对文件路径 / API Key 一律不进入模型上下文。
// 规则:凡可能出现在错误文本里的敏感片段,一律替换为固定占位符;无法确认安全的错误只回传类别。
// 说明:本模块只做「文本脱敏」,不吞掉日志侧的原始错误(原始错误仍由 Logger 记录在服务端)。

/** 脱敏后的固定占位符(措辞固定,不给模型自由发挥的空间) */
export const REDACTED_PLACEHOLDERS = {
  ip: '[IP]',
  host: '[HOST]',
  path: '[PATH]',
  secret: '[SECRET]',
  connString: '[DB_CONN]',
  stack: '[STACK]',
} as const;

/** 敏感形态正则(集中维护,便于单测覆盖;注意 lastIndex 归零后使用) */
const SENSITIVE_PATTERNS: Array<{ key: keyof typeof REDACTED_PLACEHOLDERS; re: RegExp }> = [
  // 数据库/中间件连接串:postgres://user:pass@host:5432/db、mysql://、mongodb://、redis://、amqp://、jdbc:
  {
    key: 'connString',
    re: /\b(?:jdbc:)?(?:postgres(?:ql)?|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps):\/\/[^\s'"，。;]+/gi,
  },
  // 裸 DSN:user:pass@host:port/db(无协议头也拦)
  { key: 'connString', re: /\b[A-Za-z0-9_.+-]+:[^\s@/'"]+@[A-Za-z0-9_.-]+(?::\d+)?(?:\/[^\s'"]*)?/g },
  // 密钥形态:sk-xxx / pk-xxx / rk-xxx(OpenAI、DashScope 风格)
  { key: 'secret', re: /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{8,}/g },
  // 键值对形态:api_key=xxx、apikey: xxx、password=xxx、Authorization: xxx
  {
    key: 'secret',
    re: /\b(?:api[_-]?key|access[_-]?key|secret[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|dashscope[_-]?api[_-]?key|password|passwd|pwd|token|authorization)\b\s*[:=]\s*[^\s'"，。;&]+/gi,
  },
  // Bearer 令牌
  { key: 'secret', re: /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi },
  // Node 堆栈帧:at Foo.bar (/abs/path/file.ts:12:34) / at /abs/path/file.js:1:1
  { key: 'stack', re: /^\s*at\s+[^\n]*$/gm },
  { key: 'stack', re: /\bStack(?:trace)?:\s*[\s\S]*$/gi },
  // POSIX 绝对路径:仅限已知的服务端根目录前缀,避免误伤 "/ai/result/:threadId" 这类业务串
  {
    key: 'path',
    re: /(?:^|[\s"'(=,;[])(?:\/(?:root|home|usr|var|etc|opt|tmp|app|srv|data|dist|src|node_modules|Users)\b)[^\s"'`,;)\]]*/gm,
  },
  // Windows 绝对路径:C:\foo\bar.ts
  { key: 'path', re: /\b[A-Za-z]:\\[^\s"'`,;)]+/g },
  // IPv4(含端口)。仅 0~255 合法分段,避免误伤版本号(如 8.16.2)与语义化版本
  {
    key: 'ip',
    re: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?::\d{2,5})?\b/g,
  },
  // 内网主机名:*.internal / *.local / *.svc.cluster.local
  { key: 'host', re: /\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:internal|local|lan|corp|svc|cluster\.local)\b/gi },
];

/** 脱敏后的错误摘要长度上限(错误文本不应挤占 token 预算) */
const MAX_SANITIZED_LEN = 600;

/**
 * 判断文本是否含敏感形态(IP / 连接串 / 密钥 / 绝对路径 / 堆栈)。
 * 用于在写日志、拼提示词前做一次断言式检查。
 */
export function isSensitiveText(input: unknown): boolean {
  if (input === null || input === undefined) return false;
  const s = typeof input === 'string' ? input : safeStringify(input);
  return SENSITIVE_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(s);
  });
}

/**
 * 把任意错误脱敏成可安全进入模型上下文的单行摘要。
 * - 丢弃 stack,只保留 message
 * - 逐条替换敏感片段为占位符
 * - 长度封顶,避免超长错误挤占 token 预算
 */
export function sanitizeForLlm(err: unknown): string {
  const cleaned = sanitizeText(extractMessage(err));
  if (!cleaned) return '工具执行失败(无可用错误信息)';
  return cleaned.length > MAX_SANITIZED_LEN ? `${cleaned.slice(0, MAX_SANITIZED_LEN)}…` : cleaned;
}

/** 通用文本脱敏(对外可复用于工具结果文本) */
export function sanitizeText(input: string): string {
  let s = String(input ?? '');
  for (const { key, re } of SENSITIVE_PATTERNS) {
    re.lastIndex = 0;
    s = s.replace(re, REDACTED_PLACEHOLDERS[key]);
  }
  // 折叠空白与多行(堆栈多行文本不应进入提示词)
  return s.replace(/\s*\n\s*/g, ' | ').replace(/\s{2,}/g, ' ').trim();
}

/** 从 unknown 错误中提取 message(绝不返回 stack) */
function extractMessage(err: unknown): string {
  if (err === null || err === undefined) return '';
  if (typeof err === 'string') return err;
  // 注意:不回落到 err.name —— "Error"/"TypeError" 这类类名对模型没有信息量,
  // 空 message 应当走 sanitizeForLlm 的固定兜底文案,而不是伪造一条摘要。
  if (err instanceof Error) return err.message ?? '';
  if (typeof err === 'object') {
    const anyErr = err as { message?: unknown; msg?: unknown; error?: unknown };
    if (typeof anyErr.message === 'string') return anyErr.message;
    if (typeof anyErr.msg === 'string') return anyErr.msg;
    if (typeof anyErr.error === 'string') return anyErr.error;
    return safeStringify(err);
  }
  return String(err);
}

/**
 * JSON 序列化兜底(循环引用不抛错)。
 * 对外导出:graph.ts 实体槽 ingest 需要把结构化结果序列化为文本(不做脱敏/截断,
 * 脱敏语义在 sanitizeForLlm/sanitizeText 中单独提供)。
 */
export function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
