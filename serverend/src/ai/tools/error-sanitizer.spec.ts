// 语图技术方案 - 错误脱敏单测(Task 8.4)
// 覆盖:isSensitiveText 各敏感形态识别 / sanitizeForLlm 丢堆栈+占位符替换+长度封顶 / 版本号不误伤
import { isSensitiveText, sanitizeForLlm, sanitizeText, REDACTED_PLACEHOLDERS } from './error-sanitizer';

describe('isSensitiveText', () => {
  it('识别数据库连接串 / 裸 DSN / API Key / Bearer / 内网主机 / 绝对路径 / 堆栈帧 / IPv4', () => {
    expect(isSensitiveText('postgres://user:pass@10.0.0.8:5432/aidb')).toBe(true);
    expect(isSensitiveText('jdbc:mysql://db.internal:3306/app')).toBe(true);
    expect(isSensitiveText('admin:Adm1n@db-master.local')).toBe(true);
    expect(isSensitiveText('invalid api_key=sk-abcdefgh12345678')).toBe(true);
    expect(isSensitiveText('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc')).toBe(true);
    expect(isSensitiveText('cannot resolve pg-replica.svc.cluster.local')).toBe(true);
    expect(isSensitiveText('ENOENT /root/workspace/ai-diagram/serverend/src/main.ts')).toBe(true);
    expect(isSensitiveText('missing file C:\\app\\src\\index.ts')).toBe(true);
    expect(isSensitiveText('connect ECONNREFUSED 10.12.33.44:6379')).toBe(true);
    expect(isSensitiveText('Error: boom\n    at Foo.bar (/app/src/a.ts:12:34)')).toBe(true);
    expect(isSensitiveText('Stack: TypeError at line 3')).toBe(true);
  });

  it('普通业务文本不误判(语义化版本号 / 路由 / 中文描述)', () => {
    expect(isSensitiveText('zod 版本 8.16.2 校验失败')).toBe(false);
    expect(isSensitiveText('工具 template_match 参数不合法: query 不能为空')).toBe(false);
    expect(isSensitiveText('请调用 GET /ai/result/:threadId 获取结果')).toBe(false);
    expect(isSensitiveText(null)).toBe(false);
    expect(isSensitiveText(undefined)).toBe(false);
  });
});

describe('sanitizeForLlm', () => {
  it('丢弃 stack,只保留 message 并替换敏感片段为占位符', () => {
    const err = new Error('connect ECONNREFUSED 10.12.33.44:6379');
    err.stack = 'Error: connect ECONNREFUSED 10.12.33.44:6379\n    at TCPConnectWrap (/app/src/db.ts:12:5)';

    const text = sanitizeForLlm(err);

    expect(text).not.toContain('10.12.33.44');
    expect(text).not.toContain('at TCPConnectWrap');
    expect(text).toContain(REDACTED_PLACEHOLDERS.ip);
    expect(text).toContain('ECONNREFUSED');
  });

  it('密钥与连接串被替换为固定占位符', () => {
    const text = sanitizeForLlm({ message: 'auth failed: api_key=sk-abcdefgh12345678 dsn=postgres://u:p@db.internal:5432/x' });

    expect(text).not.toContain('sk-abcdefgh12345678');
    expect(text).not.toContain('postgres://');
    expect(text).toContain(REDACTED_PLACEHOLDERS.secret);
    expect(text).toContain(REDACTED_PLACEHOLDERS.connString);
  });

  it('超长错误文本被封顶,不挤占 token 预算', () => {
    const text = sanitizeForLlm(new Error(`boom ${'x'.repeat(2000)}`));
    expect(text.length).toBeLessThanOrEqual(601); // 600 + 省略号
    expect(text.endsWith('…')).toBe(true);
  });

  it('空错误返回固定兜底文案(不抛错)', () => {
    expect(sanitizeForLlm(null)).toBe('工具执行失败(无可用错误信息)');
    expect(sanitizeForLlm(new Error(''))).toBe('工具执行失败(无可用错误信息)');
  });

  it('脱敏后的文本不再被判定为敏感(可作为「输出契约」断言)', () => {
    const raw = 'connect ECONNREFUSED 10.12.33.44:6379 (dsn=postgres://u:p@db.internal:5432/x)\n    at /app/src/db.ts:12:5';
    expect(isSensitiveText(raw)).toBe(true);
    expect(isSensitiveText(sanitizeForLlm(raw))).toBe(false);
  });
});

describe('sanitizeText', () => {
  it('多行折叠为单行(堆栈文本不进提示词)', () => {
    const text = sanitizeText('第一行\n    第二行\n第三行');
    expect(text).not.toContain('\n');
    expect(text).toContain(' | ');
  });

  it('版本号不被当作 IP 处理', () => {
    expect(sanitizeText('zod@8.16.2 校验失败')).toBe('zod@8.16.2 校验失败');
  });
});
