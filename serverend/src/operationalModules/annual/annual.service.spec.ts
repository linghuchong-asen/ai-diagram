// 语图代码年报（Round B）服务单测：mock 全局 fetch，覆盖聚合口径/错误映射/缓存/校验/埋点
import { HttpException, HttpStatus } from '@nestjs/common';
import { AnnualService, AnnualSource } from './annual.service';

/** 构造 GitHub 风格仓库条目 */
function ghRepo(overrides: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    name: 'repo',
    stargazers_count: 0,
    language: null,
    created_at: '2020-01-01T00:00:00Z',
    pushed_at: '2020-01-01T00:00:00Z',
    ...overrides,
  };
}

/** fetch 响应桩 */
function fetchOk(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as unknown as Response;
}
function fetchStatus(status: number): Response {
  return { ok: status < 400, status, json: async () => ({}) } as unknown as Response;
}

function makeService() {
  const track = jest.fn();
  const service = new AnnualService({ track } as never);
  return { service, track };
}

/** 每例后还原全局 fetch，避免用例间串扰 */
const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('AnnualService（代码年报聚合）', () => {
  it('GitHub 正常聚合：新建/活跃/stars/语言分布/最高星/最近 push 各口径正确', async () => {
    const { service, track } = makeService();
    global.fetch = jest.fn(async () =>
      fetchOk([
        ghRepo({ name: 'old-api', stargazers_count: 5, language: 'Java', created_at: '2019-05-01T00:00:00Z', pushed_at: '2026-03-01T00:00:00Z' }),
        ghRepo({ name: 'new-hot', stargazers_count: 42, language: 'TypeScript', created_at: '2026-02-01T00:00:00Z', pushed_at: '2026-06-01T00:00:00Z' }),
        ghRepo({ name: 'dusty', stargazers_count: 1, language: 'TypeScript', created_at: '2021-01-01T00:00:00Z', pushed_at: '2021-01-01T00:00:00Z' }),
        ghRepo({ name: 'no-lang', stargazers_count: 0, language: null, created_at: '2026-07-01T00:00:00Z', pushed_at: '2026-08-01T00:00:00Z' }),
      ]),
    ) as unknown as typeof fetch;

    const report = await service.getReport('github', 'dev-1', 2026);

    expect(report.repoCount).toBe(4);
    expect(report.repoCountTruncated).toBe(false);
    expect(report.reposCreatedInYear).toBe(2); // new-hot + no-lang
    expect(report.reposActiveInYear).toBe(3); // old-api + new-hot + no-lang
    expect(report.starsTotal).toBe(48); // 5+42+1+0
    expect(report.starsOfNewRepos).toBe(42); // new-hot 42 + no-lang 0
    expect(report.topLanguages).toEqual([
      ['TypeScript', 2],
      ['Java', 1],
    ]);
    expect(report.topRepo).toEqual({ name: 'new-hot', stars: 42 });
    expect(report.lastPushedRepo).toBe('no-lang'); // pushed 2026-08 最晚
    // 埋点：真实生成恰一次
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      'annual_generate',
      expect.objectContaining({ source: 'github', username: 'dev-1', repoCount: 4 }),
    );
  });

  it('Gitee 归一化：updated_at 映射为 pushedAt 语义', async () => {
    const { service } = makeService();
    global.fetch = jest.fn(async () =>
      fetchOk([
        {
          name: 'gitee-repo',
          stargazers_count: 7,
          language: 'Go',
          created_at: '2025-11-01T00:00:00+08:00',
          updated_at: '2026-01-15T00:00:00+08:00',
        },
      ]),
    ) as unknown as typeof fetch;

    const report = await service.getReport('gitee', 'dev-2', 2026);
    expect(report.repoCount).toBe(1);
    expect(report.reposActiveInYear).toBe(1); // updated_at 2026
    expect(report.reposCreatedInYear).toBe(0); // created 2025
    expect(report.topLanguages).toEqual([['Go', 1]]);
  });

  it('满页 100 条 → repoCountTruncated = true（口径诚实标记）', async () => {
    const { service } = makeService();
    const repos = Array.from({ length: 100 }, (_, i) => ghRepo({ name: `r${i}` }));
    global.fetch = jest.fn(async () => fetchOk(repos)) as unknown as typeof fetch;
    const report = await service.getReport('github', 'dev-3', 2026);
    expect(report.repoCount).toBe(100);
    expect(report.repoCountTruncated).toBe(true);
  });

  it('上游 404 → 404 用户不存在；403 → 429 限额；网络异常 → 502', async () => {
    const { service } = makeService();
    global.fetch = jest.fn(async () => fetchStatus(404)) as unknown as typeof fetch;
    await expect(service.getReport('github', 'ghost', 2026)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });

    global.fetch = jest.fn(async () => fetchStatus(403)) as unknown as typeof fetch;
    await expect(service.getReport('github', 'dev-4', 2026)).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });

    global.fetch = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;
    await expect(service.getReport('github', 'dev-5', 2026)).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('参数校验：非法用户名 / 非法年份 / 未知来源 → 400，且不发起上游请求', async () => {
    const { service } = makeService();
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    await expect(service.getReport('github', '../evil?x=1', 2026)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(service.getReport('github', 'dev', 1999)).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    // 未知来源：类型层面已收敛为 AnnualSource，这里模拟绕过类型的客户端入参
    await expect(
      service.getReport('gitlab' as AnnualSource, 'dev', 2026),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(spy).not.toHaveBeenCalled();
  });

  it('缓存：同 source:user:year 两次调用只打一次上游，且埋点只计一次', async () => {
    const { service, track } = makeService();
    const spy = jest.fn(async () => fetchOk([ghRepo({ name: 'only' })]));
    global.fetch = spy as unknown as typeof fetch;

    const first = await service.getReport('github', 'Cache-User', 2026);
    const second = await service.getReport('github', 'cache-user', 2026); // 用户名大小写不敏感
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('空仓库列表 → 零值报告不报错（新用户也有卡可晒）', async () => {
    const { service } = makeService();
    global.fetch = jest.fn(async () => fetchOk([])) as unknown as typeof fetch;
    const report = await service.getReport('github', 'fresh-dev', 2026);
    expect(report.repoCount).toBe(0);
    expect(report.topRepo).toBeNull();
    expect(report.topLanguages).toEqual([]);
  });
});
