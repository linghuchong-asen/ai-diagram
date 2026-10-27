// 语图 Round J（网页正文抓取）服务单测：mock 全局 fetch
// 覆盖：SSRF 防御（协议/内网）、Content-Type 白名单、正文启发式提取、
//      标题提取、2000 字截断、错误映射（非 2xx/超时）、缓存去重、埋点。
import { HttpException, HttpStatus } from '@nestjs/common';
import {
  DigestFetchService,
  assertPublicHttpUrl,
  extractTextFromHtml,
} from './digest-fetch.service';

function makeService() {
  const track = jest.fn();
  return { service: new DigestFetchService({ track } as never), track };
}

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: new Map([['content-type', 'text/html; charset=utf-8']]),
    text: async () => html,
  } as unknown as Response;
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('assertPublicHttpUrl：SSRF 防御', () => {
  it('合法 https 公网 URL 通过并归一化', () => {
    expect(assertPublicHttpUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });

  it('非 http(s) 协议拒绝（javascript:/ftp:）', () => {
    for (const bad of ['javascript:alert(1)', 'ftp://x.com', 'file:///etc/passwd']) {
      expect(() => assertPublicHttpUrl(bad)).toThrow(HttpException);
    }
  });

  it('内网/环回地址拒绝', () => {
    for (const bad of [
      'http://localhost/x',
      'http://127.0.0.1/x',
      'http://10.1.2.3/x',
      'http://192.168.1.1/x',
      'http://172.16.0.1/x',
      'http://169.254.169.254/latest/meta-data',
    ]) {
      expect(() => assertPublicHttpUrl(bad)).toThrow(HttpException);
    }
  });

  it('非法字符串 → 400', () => {
    expect(() => assertPublicHttpUrl('not a url')).toThrow(HttpException);
  });
});

describe('extractTextFromHtml：启发式正文提取', () => {
  it('剔除 script/style/nav 等噪声块，保留正文文本', () => {
    const html =
      '<html><head><title>T</title><style>.a{}</style><script>var x=1;</script></head>' +
      '<body><nav>首页 产品 定价 关于我们 登录注册</nav>' +
      '<p>第一步：用户在收银台选择支付方式。</p><p>第二步：支付成功后返回商户页面。</p>' +
      '<footer>© 2026 某某公司 版权所有 备案号</footer></body></html>';
    const text = extractTextFromHtml(html);
    expect(text).toContain('收银台选择支付方式');
    expect(text).toContain('返回商户页面');
    expect(text).not.toContain('var x=1');
    expect(text).not.toContain('.a{}');
  });

  it('常见 HTML 实体还原（nbsp/amp/lt/gt/quot）', () => {
    const text = extractTextFromHtml('<p>A&nbsp;&amp;&nbsp;B &lt;tag&gt; &quot;q&quot;</p>');
    expect(text).toContain('A & B');
    expect(text).toContain('<tag>');
    expect(text).toContain('"q"');
  });

  it('过短行（导航残片）被过滤', () => {
    const text = extractTextFromHtml('<div>首页</div><p>这一行是足够长的正文内容用于保留。</p>');
    expect(text).not.toContain('首页');
    expect(text).toContain('足够长的正文内容');
  });
});

describe('DigestFetchService.fetchUrlText', () => {
  it('正常抓取：返回标题 + 正文 + 埋点恰一次', async () => {
    const { service, track } = makeService();
    global.fetch = jest.fn(async () =>
      htmlResponse(
        '<html><head><title>报销制度说明</title></head><body><p>员工报销需在三十天内提交申请并附上发票原件。</p></body></html>',
      ),
    ) as unknown as typeof fetch;

    const result = await service.fetchUrlText('https://example.com/policy');
    expect(result.title).toBe('报销制度说明');
    expect(result.text).toContain('三十天内提交申请');
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith(
      'digest_url_fetch',
      expect.objectContaining({ host: 'example.com' }),
    );
  });

  it('缓存：同 URL 二次调用只抓一次（埋点也只计一次）', async () => {
    const { service, track } = makeService();
    const spy = jest.fn(async () => htmlResponse('<p>这是一段足够长的正文内容示例文本。</p>'));
    global.fetch = spy as unknown as typeof fetch;
    await service.fetchUrlText('https://example.com/a');
    const second = await service.fetchUrlText('https://example.com/a');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(second.text).toContain('正文内容');
    expect(track).toHaveBeenCalledTimes(1);
  });

  it('超长正文截断到 2000 字并标记 truncated', async () => {
    const { service } = makeService();
    const longParagraph = '这是用于测试截断逻辑的超长正文段落。'.repeat(300); // 远超 2000
    global.fetch = jest.fn(async () =>
      htmlResponse(`<p>${longParagraph}</p>`),
    ) as unknown as typeof fetch;
    const result = await service.fetchUrlText('https://example.com/long');
    expect(result.text.length).toBeLessThanOrEqual(2000);
    expect(result.truncated).toBe(true);
  });

  it('非 HTML Content-Type（如图片/JSON）→ 422', async () => {
    const { service } = makeService();
    global.fetch = jest.fn(async () =>
      ({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'image/png']]),
        text: async () => '',
      }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(service.fetchUrlText('https://example.com/img.png')).rejects.toMatchObject({
      status: HttpStatus.UNPROCESSABLE_ENTITY,
    });
  });

  it('上游非 2xx → 502；网络异常/超时 → 502', async () => {
    const { service } = makeService();
    global.fetch = jest.fn(async () =>
      ({ ok: false, status: 404, headers: new Map(), text: async () => '' }) as unknown as Response,
    ) as unknown as typeof fetch;
    await expect(service.fetchUrlText('https://example.com/404')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });

    global.fetch = jest.fn(async () => {
      throw new Error('timeout');
    }) as unknown as typeof fetch;
    await expect(service.fetchUrlText('https://example.com/slow')).rejects.toMatchObject({
      status: HttpStatus.BAD_GATEWAY,
    });
  });

  it('内网 URL 在服务入口即被拒绝（不打上游）', async () => {
    const { service } = makeService();
    const spy = jest.fn();
    global.fetch = spy as unknown as typeof fetch;
    await expect(service.fetchUrlText('http://127.0.0.1:8080/admin')).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    expect(spy).not.toHaveBeenCalled();
  });
});
