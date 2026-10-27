// 语图代码年报（Round B · annual-report-batch）服务
// 职责：只读 GitHub/Gitee 公开 API，聚合同步开发者年度公开仓库统计。
// 设计要点：
//   1) 零 LLM 成本 —— 统计为确定性聚合，卡片渲染在前端 Canvas，完全不消耗 AI 额度；
//   2) 诚实口径 —— 只统计公开仓库维度的数据（总数/新建/活跃/stars/语言分布），
//      不碰 GitHub events 的 90 天限制，不承诺 commit 数；
//   3) 防刷与防滥用 —— 服务端 5 分钟内存缓存 + 单页 100 仓库截断标记 +
//      用户名白名单校验（URL 由常量拼接，杜绝 SSRF 探测）；
//   4) 上游错误语义映射 —— 404 用户不存在 / 403 上限额 429 / 网络异常 502。
import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { GrowthEventService } from '../../observability/growth-event.service';

/** 支持的代码托管平台（公开数据源） */
export type AnnualSource = 'github' | 'gitee';

/** 归一化后的单仓库条目（两个平台字段名差异在 normalize 内抹平） */
interface NormalizedRepo {
  name: string;
  stars: number;
  language: string | null;
  createdAt: string;
  pushedAt: string;
}

/** 年报聚合结果（前端契约） */
export interface AnnualReport {
  source: AnnualSource;
  username: string;
  year: number;
  /** 公开仓库总数（受单页 100 条限制，截断时置 true） */
  repoCount: number;
  repoCountTruncated: boolean;
  /** 年内新建仓库数 */
  reposCreatedInYear: number;
  /** 年内有 push/更新的仓库数（活跃） */
  reposActiveInYear: number;
  /** 全部公开仓库累计 stars */
  starsTotal: number;
  /** 年内新建仓库累计获得的 stars */
  starsOfNewRepos: number;
  /** 语言分布 Top5（[语言, 仓库数] 降序） */
  topLanguages: Array<[string, number]>;
  /** stars 最高的仓库 */
  topRepo: { name: string; stars: number } | null;
  /** 最近一次 push 的仓库名 */
  lastPushedRepo: string | null;
}

/** 用户名白名单（两平台规则交集：字母/数字/下划线/连字符，≤64） */
const USERNAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** 年份合法范围（git 诞生 2008 年起；上界 = 当前年 + 1 容忍跨年瞬间） */
const MIN_YEAR = 2008;

/** 缓存 TTL：5 分钟内同 source:user:year 直接命中，防同一用户被反复刷上游 */
const CACHE_TTL_MS = 5 * 60 * 1000;
/** 缓存条目上限（超限全量清理过期项，照抄限流 Guard 的 sweep 模式） */
const CACHE_MAX_KEYS = 500;

/** 单页拉取条数（两平台 per_page 上限均为 100；超过即截断标记） */
const PER_PAGE = 100;

/** 平台 API 地址拼装（用户名已过白名单校验，无 SSRF 面） */
function reposUrl(source: AnnualSource, username: string): string {
  return source === 'github'
    ? `https://api.github.com/users/${username}/repos?per_page=${PER_PAGE}&sort=pushed`
    : `https://gitee.com/api/v5/users/${username}/repos?type=all&per_page=${PER_PAGE}&page=1`;
}

/** 平台返回条目 → 归一化（GitHub: pushed_at/language；Gitee: updated_at/language） */
function normalizeRepo(source: AnnualSource, raw: Record<string, unknown>): NormalizedRepo | null {
  const name = String(raw.name ?? '').trim();
  if (!name) return null;
  return {
    name,
    stars: Number(raw.stargazers_count) || 0,
    language: typeof raw.language === 'string' && raw.language.trim() ? raw.language.trim() : null,
    createdAt: String(raw.created_at ?? ''),
    pushedAt: String(
      (source === 'github' ? raw.pushed_at : raw.updated_at) ?? raw.pushed_at ?? '',
    ),
  };
}

/** 年份命中判定：ISO 时间串以 "YYYY" 开头（无需完整解析，零时区歧义近似按平台记录年） */
function inYear(iso: string, year: number): boolean {
  return iso.startsWith(String(year));
}

@Injectable()
export class AnnualService {
  /** 报告缓存：key = source:user:year → { report, expireAt } */
  private readonly cache = new Map<string, { report: AnnualReport; expireAt: number }>();

  constructor(private readonly growthEvent: GrowthEventService) {}

  /**
   * 生成年度公开仓库统计（公开端点消费）。
   * 抛错语义：400 参数非法 ｜ 404 用户不存在 ｜ 429 上游限额/查询过频 ｜ 502 上游不可达。
   */
  async getReport(source: AnnualSource, username: string, year: number): Promise<AnnualReport> {
    // 1) 入参校验（用户名白名单 + 年份范围）
    if (source !== 'github' && source !== 'gitee') {
      throw new HttpException('不支持的数据源', HttpStatus.BAD_REQUEST);
    }
    const user = String(username ?? '').trim();
    if (!USERNAME_RE.test(user)) {
      throw new HttpException('用户名不合法', HttpStatus.BAD_REQUEST);
    }
    const maxYear = new Date().getFullYear() + 1;
    if (!Number.isInteger(year) || year < MIN_YEAR || year > maxYear) {
      throw new HttpException('年份不合法', HttpStatus.BAD_REQUEST);
    }

    // 2) 缓存命中直接返回（不计埋点，避免重复计数）
    const cacheKey = `${source}:${user.toLowerCase()}:${year}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expireAt > Date.now()) {
      return cached.report;
    }

    // 3) 拉取上游公开仓库列表（单页 100，超过即截断标记）
    let rawRepos: Array<Record<string, unknown>>;
    try {
      const response = await fetch(reposUrl(source, user), {
        headers: {
          Accept: 'application/json',
          // GitHub 要求自定义 UA；两平台统一携带
          'User-Agent': 'yutu-annual/1.0',
        },
      });
      if (response.status === 404) {
        throw new HttpException('用户不存在（或该平台暂无此用户）', HttpStatus.NOT_FOUND);
      }
      if (response.status === 403 || response.status === 429) {
        throw new HttpException(
          '上游接口调用额度受限，请稍后再试',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      if (!response.ok) {
        throw new HttpException(
          '上游服务暂时不可用，请稍后再试',
          HttpStatus.BAD_GATEWAY,
        );
      }
      const parsed = (await response.json()) as unknown;
      if (!Array.isArray(parsed)) {
        throw new HttpException('上游服务暂时不可用，请稍后再试', HttpStatus.BAD_GATEWAY);
      }
      rawRepos = parsed as Array<Record<string, unknown>>;
    } catch (error) {
      // fetch 网络异常（DNS/超时/断网）→ 502；HttpException 原样透传
      if (error instanceof HttpException) throw error;
      throw new HttpException('上游服务暂时不可用，请稍后再试', HttpStatus.BAD_GATEWAY);
    }

    // 4) 确定性聚合（诚实口径：仅公开仓库维度，不承诺 commit 数）
    const repos = rawRepos
      .map((raw) => normalizeRepo(source, raw))
      .filter((item): item is NormalizedRepo => item !== null);
    const truncated = rawRepos.length >= PER_PAGE;

    const languageCounter = new Map<string, number>();
    let starsTotal = 0;
    let starsOfNewRepos = 0;
    let reposCreatedInYear = 0;
    let reposActiveInYear = 0;
    let topRepo: { name: string; stars: number } | null = null;
    let lastPushedRepo: string | null = null;
    let lastPushedAt = '';

    for (const repo of repos) {
      starsTotal += repo.stars;
      const createdThisYear = inYear(repo.createdAt, year);
      if (createdThisYear) {
        reposCreatedInYear += 1;
        starsOfNewRepos += repo.stars;
      }
      if (inYear(repo.pushedAt, year)) {
        reposActiveInYear += 1;
      }
      if (repo.language) {
        languageCounter.set(repo.language, (languageCounter.get(repo.language) ?? 0) + 1);
      }
      if (!topRepo || repo.stars > topRepo.stars) {
        topRepo = { name: repo.name, stars: repo.stars };
      }
      // 列表按 pushed 排序时首个即最近；仍做一遍兜底比较
      if (repo.pushedAt > lastPushedAt) {
        lastPushedAt = repo.pushedAt;
        lastPushedRepo = repo.name;
      }
    }

    const topLanguages = [...languageCounter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);

    const report: AnnualReport = {
      source,
      username: user,
      year,
      repoCount: repos.length,
      repoCountTruncated: truncated,
      reposCreatedInYear,
      reposActiveInYear,
      starsTotal,
      starsOfNewRepos,
      topLanguages,
      topRepo,
      lastPushedRepo,
    };

    // 5) 写缓存（先清理过期，防 Map 无界增长）
    this.sweepExpired();
    this.cache.set(cacheKey, { report, expireAt: Date.now() + CACHE_TTL_MS });

    // 6) 埋点：一次真实生成（缓存命中不计）—— 年报是事件营销，衡量入口效率
    this.growthEvent.track('annual_generate', {
      source,
      username: user,
      repoCount: report.repoCount,
    });

    return report;
  }

  /** 清理过期缓存条目（达到上限时全量扫一遍过期项） */
  private sweepExpired(): void {
    if (this.cache.size < CACHE_MAX_KEYS) return;
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expireAt <= now) this.cache.delete(key);
    }
  }
}
