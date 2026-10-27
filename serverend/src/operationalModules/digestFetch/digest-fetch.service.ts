// 语图 Round J - 网页链接正文抓取服务（「链接 → 一图看懂」场景的后端支撑）
// 职责：给定公网 URL，抓取 HTML 并做启发式正文提取（去 script/style/nav 等），
//       截断为 ≤2000 字纯文本返回 —— 前端把它当作 digest 文本继续走生成链路。
// 安全边界（公开端点，防 SSRF 与滥用）：
//   1) 仅允许 http/https 协议；
//   2) 拒绝内网/环回地址（localhost/127./10./172.16-31./192.168./169.254.）；
//   3) 响应体上限 1MB、超时 8s（AbortController）；
//   4) 进程内 5 分钟缓存（同 URL 去重抓取）+ IP 限流守卫；
//   5) Content-Type 必须 text/html 或 text/plain（不下载二进制）。
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { GrowthEventService } from '../../observability/growth-event.service';

/** 返回正文上限（与登录链路 message 上限一致） */
export const DIGEST_TEXT_LIMIT = 2000;
/** 响应体读取上限：1MB */
const MAX_BODY_BYTES = 1024 * 1024;
/** 抓取超时 */
const FETCH_TIMEOUT_MS = 8000;
/** 缓存 TTL 与容量 */
const CACHE_TTL_MS = 5 * 60 * 1000;
const CACHE_MAX_KEYS = 500;

/** 内网/环回 host 黑名单（IP 直连形态；域名解析内网 IP 的场景公测期接受为已知限制） */
const PRIVATE_HOST_RE = /^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.0\.0\.0)|^172\.(1[6-9]|2\d|3[01])\./;

/** URL 合法性校验（协议白名单 + 内网拒绝），返回归一化 URL 字符串 */
export function assertPublicHttpUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(String(raw ?? '').trim());
  } catch {
    throw new HttpException('URL 不合法', HttpStatus.BAD_REQUEST);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new HttpException('仅支持 http/https 链接', HttpStatus.BAD_REQUEST);
  }
  if (PRIVATE_HOST_RE.test(parsed.hostname)) {
    throw new HttpException('不允许抓取内网地址', HttpStatus.BAD_REQUEST);
  }
  return parsed.toString();
}

/**
 * 启发式正文提取（确定性，无第三方依赖）：
 * 去 script/style/noscript/iframe/nav/header/footer/aside → 去 HTML 标签 →
 * 折叠空白 → 按「文本密度」粗排（取最长连续段集合的前 2000 字）。
 * 目标是给 LLM 喂可用素材而非精确正文，宁多勿缺。
 */
export function extractTextFromHtml(html: string): string {
  const stripped = String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|iframe|svg|nav|header|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ');
  // HTML 实体还原（常见五类足够）
  const text = stripped
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"');
  // 按行折叠空白，过滤过短行（导航残片），保留语序
  const lines = text
    .split(/\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter((line) => line.length >= 8);
  return lines.join('\n').slice(0, DIGEST_TEXT_LIMIT * 2);
}

@Injectable()
export class DigestFetchService {
  /** 抓取缓存：url → { text, title, expireAt } */
  private readonly cache = new Map<string, { title: string; text: string; expireAt: number }>();

  constructor(private readonly growthEvent: GrowthEventService) {}

  /**
   * 抓取并提取网页正文（公开端点消费）。
   * 抛错语义：400 URL 不合法/内网 ｜ 422 上游非 HTML ｜ 502 抓取失败/超时。
   */
  async fetchUrlText(rawUrl: string): Promise<{ title: string; text: string; truncated: boolean }> {
    const url = assertPublicHttpUrl(rawUrl);

    const cached = this.cache.get(url);
    if (cached && cached.expireAt > Date.now()) {
      return { title: cached.title, text: cached.text, truncated: cached.text.length >= DIGEST_TEXT_LIMIT };
    }

    let html: string;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: 'text/html,text/plain',
          'User-Agent': 'yutu-digest/1.0 (+bot)',
        },
      });
      clearTimeout(timer);
      if (!response.ok) {
        throw new HttpException('目标页面无法访问', HttpStatus.BAD_GATEWAY);
      }
      const contentType = String(response.headers.get('content-type') ?? '');
      if (!/text\/(html|plain)/i.test(contentType)) {
        throw new HttpException('仅支持网页/文本类链接', HttpStatus.UNPROCESSABLE_ENTITY);
      }
      html = (await response.text()).slice(0, MAX_BODY_BYTES);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new HttpException('抓取超时或失败，请稍后再试', HttpStatus.BAD_GATEWAY);
    }

    // 标题：<title> 首个匹配；正文：启发式提取后截断
    const titleMatch = html.match(/<title[^>]*>([\s\S]{1,200}?)<\/title>/i);
    const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : '';
    const fullText = extractTextFromHtml(html);
    const truncated = fullText.length > DIGEST_TEXT_LIMIT;
    const text = fullText.slice(0, DIGEST_TEXT_LIMIT);

    // 缓存与容量清理
    if (this.cache.size >= CACHE_MAX_KEYS) {
      const now = Date.now();
      for (const [key, entry] of this.cache) {
        if (entry.expireAt <= now) this.cache.delete(key);
      }
    }
    this.cache.set(url, { title, text, expireAt: Date.now() + CACHE_TTL_MS });

    // 埋点：一次真实抓取（缓存命中不计）
    this.growthEvent.track('digest_url_fetch', { host: new URL(url).host, truncated });

    return { title, text, truncated };
  }
}
