// 语图 Task 6：虎皮椒适配器单测（纯逻辑直测：固定参数 + 固定 secret → 已知 md5 摘要）
import { XunhupayAdapter, xunhupaySign } from './xunhupay.adapter';

const ENV_KEYS = ['XUNHU_APP_ID', 'XUNHU_APP_SECRET', 'BASE_URL'] as const;
let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe('xunhupaySign（MD5 签名纯函数）', () => {
  it('固定 fixture：已知参数 + 已知 secret → 已知摘要（小写十六进制）', () => {
    // 参数按 key ASCII 升序拼串：appid=test-appid&total_fee=1.90&trade_order_id=order-1
    // 末尾直接接 secret（无 & 分隔）后取 md5 小写
    const params = {
      appid: 'test-appid',
      total_fee: '1.90',
      trade_order_id: 'order-1',
    };
    expect(xunhupaySign(params, 'test-secret')).toBe(
      'fda524989e57a653d02de4a9a0104b39',
    );
  });

  it('key 按 ASCII 升序 + 剔除空值与 hash 字段', () => {
    // 参与签名的只有 a=1&b=2（c 空值、hash 本身被剔除），末尾直接接 sk
    const params = { b: '2', a: '1', c: '', hash: 'xxxx' };
    expect(xunhupaySign(params, 'sk')).toBe('f026231741e38d53c6f26fcd41591392');
  });
});

describe('XunhupayAdapter（通道配置判定与下单参数）', () => {
  it('未配置（缺 appid 或 secret 任一）→ createPayment 返回 null（赞助模式）', async () => {
    const adapter = new XunhupayAdapter();
    expect(adapter.isConfigured()).toBe(false);
    await expect(
      adapter.createPayment({ id: 'o1', amount: 190 }),
    ).resolves.toBeNull();

    process.env.XUNHU_APP_ID = 'appid-1'; // 只配 appid，缺 secret
    expect(adapter.isConfigured()).toBe(false);
    await expect(
      adapter.createPayment({ id: 'o1', amount: 190 }),
    ).resolves.toBeNull();
  });

  it('已配置 → 返回网关 payUrl，金额分转元两位小数，参数完整', async () => {
    process.env.XUNHU_APP_ID = 'appid-1';
    process.env.XUNHU_APP_SECRET = 'secret-1';
    process.env.BASE_URL = 'http://8.140.203.51';
    const adapter = new XunhupayAdapter();
    const payment = await adapter.createPayment({
      id: 'order-1',
      amount: 190,
      origin: 'http://localhost:5173',
    });
    expect(payment).not.toBeNull();
    const payUrl = payment!.payUrl;
    expect(payUrl.startsWith('https://api.xunhupay.com/payment/do.html?')).toBe(true);
    expect(payUrl).toContain('appid=appid-1');
    expect(payUrl).toContain('trade_order_id=order-1');
    expect(payUrl).toContain('total_fee=1.90'); // 190 分 → 1.90 元
    expect(payUrl).toContain('type=QR');
    expect(payUrl).toContain('version=2.0');
    // 回调地址与前端回跳页须在解码后的完整 URL 里断言（查询串是 URL 编码过的）
    expect(decodeURIComponent(payUrl)).toContain('/api/billing/notify/xunhupay');
    expect(decodeURIComponent(payUrl)).toContain('http://localhost:5173/unlock-result');
    expect(payUrl).toMatch(/hash=[0-9a-f]{32}$/); // md5 小写 32 位签名收尾
  });
});
