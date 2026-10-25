// 语图技术方案 - Task 4（utils/aiClient）可执行断言脚本
// 覆盖：ThinkSseEvent 帧解析（命名事件 / 仅 data 部分 / 裸 message 帧 / 脏输入）、
//      轮询退避序列与 Retry-After 解析 clamp、HttpError / toHttpError 构造、
//      unwrapEnvelope、normalizeResultPayload 四态、normalizeConfirmPayload、URL 构造。
// 运行：cd frontend && npx tsx src/utils/__checks__/aiClient.check.ts

import {
  AI_API_BASE,
  ERROR_BODY_SUMMARY_LIMIT,
  HttpError,
  AbortError,
  chatUrl,
  confirmUrl,
  isAbortError,
  nextPollDelayMs,
  normalizeConfirmPayload,
  normalizeResultPayload,
  parseRetryAfterSeconds,
  parseThinkSseEvent,
  pickBodyMessage,
  POLL_BASE_DELAY_MS,
  POLL_MAX_DELAY_MS,
  POLL_MIN_DELAY_MS,
  readAuthToken,
  resultUrl,
  summarizeErrorBody,
  thinkStreamUrl,
  toHttpError,
  unwrapEnvelope,
} from '../aiClient';
import {
  assertDeepEqual,
  assertEqual,
  assertFalse,
  assertTrue,
  describe,
  finish,
  it,
} from '../../pages/ai/__checks__/check-util';

describe('URL 构造：始终相对路径，不硬编码域名', () => {
  it('chat/think/result/confirm 均以 /api 为前缀', () => {
    assertEqual(AI_API_BASE, '/api', 'AI_API_BASE 应为 /api');
    assertEqual(chatUrl(), '/api/ai/chat', 'chatUrl');
    assertEqual(thinkStreamUrl('t1'), '/api/ai/think/t1', 'thinkStreamUrl');
    assertEqual(resultUrl('t1'), '/api/ai/result/t1', 'resultUrl');
    assertEqual(confirmUrl('t1'), '/api/ai/confirm/t1', 'confirmUrl');
  });

  it('threadId 做 URL 编码，避免路径注入', () => {
    assertEqual(
      thinkStreamUrl('a/b?c=1'),
      '/api/ai/think/a%2Fb%3Fc%3D1',
      'threadId 应被 encodeURIComponent',
    );
    assertEqual(
      resultUrl('a b'),
      '/api/ai/result/a%20b',
      'resultUrl 同样编码',
    );
  });

  it('无 token 时 authHeaders 为空对象（readAuthToken 在无 localStorage 环境返回 null）', () => {
    const token = readAuthToken();
    assertTrue(token === null || typeof token === 'string', 'readAuthToken 不应抛错');
  });
});

describe('parseThinkSseEvent：与后端 think.stream.ts 帧格式对齐', () => {
  it('后端真实帧：event 名 + data 仅为 data 部分', () => {
    const thinking = parseThinkSseEvent('thinking', '{"token":"分"}');
    assertDeepEqual(
      thinking,
      { type: 'thinking', data: { token: '分' } },
      'thinking 帧应解出 token',
    );

    const done = parseThinkSseEvent('done', '{"threadId":"th-1"}');
    assertDeepEqual(done, { type: 'done', data: { threadId: 'th-1' } }, 'done 帧应解出 threadId');

    const failed = parseThinkSseEvent('error', '{"message":"上游超时"}');
    assertDeepEqual(
      failed,
      { type: 'error', data: { message: '上游超时' } },
      'error 帧应解出 message',
    );
  });

  it('兼容 data 为完整事件对象（{ type, data }）', () => {
    assertDeepEqual(
      parseThinkSseEvent('thinking', '{"type":"thinking","data":{"token":"x"}}'),
      { type: 'thinking', data: { token: 'x' } },
      '事件整体形态应可解析',
    );
  });

  it('缺省 event 名时按 data 内的 type 推断（裸 message 帧）', () => {
    assertDeepEqual(
      parseThinkSseEvent(null, '{"type":"thinking","data":{"token":"y"}}'),
      { type: 'thinking', data: { token: 'y' } },
      'event 名缺省应回落到 data.type',
    );
    assertDeepEqual(
      parseThinkSseEvent('', '{"type":"done","data":{"threadId":"th-2"}}'),
      { type: 'done', data: { threadId: 'th-2' } },
      '空字符串 event 名同样回落',
    );
    assertDeepEqual(
      parseThinkSseEvent(undefined, '{"type":"error","data":{"message":"boom"}}'),
      { type: 'error', data: { message: 'boom' } },
      'undefined event 名同样回落',
    );
  });

  it('脏输入统一返回 null，不抛错', () => {
    assertTrue(parseThinkSseEvent('thinking', '') === null, '空 data 应为 null');
    assertTrue(parseThinkSseEvent('thinking', undefined) === null, 'undefined data 应为 null');
    assertTrue(parseThinkSseEvent('thinking', 'not-json') === null, '非法 JSON 应为 null');
    assertTrue(parseThinkSseEvent('thinking', '"just-string"') === null, '非对象 JSON 应为 null');
    assertTrue(parseThinkSseEvent('unknown', '{"token":"a"}') === null, '未知 event 名应为 null');
    assertTrue(parseThinkSseEvent(null, '{}') === null, '无 type 且无 event 名应为 null');
  });

  it('字段缺失时降级为空串 / 兜底文案，不产生 undefined', () => {
    assertDeepEqual(
      parseThinkSseEvent('thinking', '{}'),
      { type: 'thinking', data: { token: '' } },
      'token 缺失应为空串',
    );
    assertDeepEqual(
      parseThinkSseEvent('done', '{}'),
      { type: 'done', data: { threadId: '' } },
      'threadId 缺失应为空串（调用方回落本地 threadId）',
    );
    assertDeepEqual(
      parseThinkSseEvent('error', '{}'),
      { type: 'error', data: { message: 'AI 执行失败' } },
      'message 缺失应给兜底文案',
    );
  });
});

describe('nextPollDelayMs：Retry-After 优先，否则 1s→2s→3s 封顶', () => {
  it('无 Retry-After 时线性退避并封顶', () => {
    assertEqual(nextPollDelayMs(1), POLL_BASE_DELAY_MS, '第 1 次 1s');
    assertEqual(nextPollDelayMs(2), 2000, '第 2 次 2s');
    assertEqual(nextPollDelayMs(3), POLL_MAX_DELAY_MS, '第 3 次 3s');
    assertEqual(nextPollDelayMs(4), POLL_MAX_DELAY_MS, '第 4 次仍 3s（封顶）');
    assertEqual(nextPollDelayMs(100), POLL_MAX_DELAY_MS, '大次数不越界');
  });

  it('非法 attempt 退化为 1s，不产生 0 或 NaN', () => {
    assertEqual(nextPollDelayMs(0), POLL_BASE_DELAY_MS, 'attempt=0 视为 1');
    assertEqual(nextPollDelayMs(-3), POLL_BASE_DELAY_MS, '负数视为 1');
    assertEqual(nextPollDelayMs(1.6), POLL_BASE_DELAY_MS, '小数向下取整');
    assertEqual(nextPollDelayMs(Number.NaN), POLL_BASE_DELAY_MS, 'NaN 视为 1');
  });

  it('Retry-After（秒）生效', () => {
    assertEqual(nextPollDelayMs(1, '0.5'), 500, '后端实际发送 Retry-After: 0.5');
    assertEqual(nextPollDelayMs(3, '2'), 2000, 'Retry-After 覆盖退避序列');
  });

  it('Retry-After clamp 到 [250ms, 10s]', () => {
    assertEqual(nextPollDelayMs(1, '0'), POLL_MIN_DELAY_MS, '0 秒被抬到下限，避免忙轮询');
    assertEqual(nextPollDelayMs(1, '0.1'), POLL_MIN_DELAY_MS, '过小时抬到下限');
    assertEqual(nextPollDelayMs(1, '600'), 10000, '过大时压到上限');
  });

  it('非法 / 空 Retry-After 回落退避序列', () => {
    assertEqual(nextPollDelayMs(2, null), 2000, 'null 回落');
    assertEqual(nextPollDelayMs(2, ''), 2000, '空串回落');
    assertEqual(nextPollDelayMs(2, 'abc'), 2000, '非日期非数字回落');
  });
});

describe('parseRetryAfterSeconds：支持秒数与 HTTP-date', () => {
  it('秒数解析', () => {
    assertEqual(parseRetryAfterSeconds('0.5'), 0.5, '小数秒');
    assertEqual(parseRetryAfterSeconds('3'), 3, '整数秒');
    assertEqual(parseRetryAfterSeconds(' 2 '), 2, '容忍空白');
    assertEqual(parseRetryAfterSeconds('0'), 0, '0 秒合法');
  });

  it('HTTP-date 解析为非负秒数', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const seconds = parseRetryAfterSeconds(future);
    assertTrue(seconds !== null, 'HTTP-date 应可解析');
    assertTrue((seconds as number) > 3 && (seconds as number) <= 5.001, '约 5 秒');

    const past = new Date(Date.now() - 60000).toUTCString();
    assertEqual(parseRetryAfterSeconds(past), 0, '过去时间应 clamp 到 0');
  });

  it('无法解析返回 null', () => {
    assertTrue(parseRetryAfterSeconds(null) === null, 'null');
    assertTrue(parseRetryAfterSeconds(undefined) === null, 'undefined');
    assertTrue(parseRetryAfterSeconds('') === null, '空串');
    assertTrue(parseRetryAfterSeconds('soon') === null, '非数字非日期');
    assertTrue(parseRetryAfterSeconds('-1') === null, '负秒数非法（不可被 Date.parse 误当年份）');
    assertTrue(parseRetryAfterSeconds('-1.5') === null, '负小数非法');
    assertTrue(parseRetryAfterSeconds(' -1 ') === null, '带空白的负数同样非法');
  });

  it('负 / 非法 Retry-After 回落退避序列', () => {
    assertEqual(nextPollDelayMs(2, '-1'), 2000, '负值回落');
    assertEqual(nextPollDelayMs(2, 'soon'), 2000, '非数字非日期回落');
  });
});

describe('HttpError / toHttpError：取代 JSON.stringify(axiosError) === "{}"', () => {
  it('HttpError 保留 message、status、data、bodySummary', () => {
    const err = new HttpError('提交确认失败', 400, { choice: 'bad' });
    assertTrue(err instanceof Error, 'HttpError 是 Error 子类');
    assertEqual(err.name, 'HttpError', 'name');
    assertEqual(err.message, '提交确认失败', 'message');
    assertEqual(err.status, 400, 'status');
    assertDeepEqual(err.data, { choice: 'bad' }, 'data');
    assertEqual(err.bodySummary, '{"choice":"bad"}', 'bodySummary');
  });

  it('axios 错误：JSON.stringify 得 "{}"，HttpError 得可读信息', () => {
    // axios 错误的属性全部不可枚举，旧实现因此丢光信息
    const axiosLike: any = {};
    Object.defineProperty(axiosLike, 'message', {
      value: 'Request failed with status code 500',
      enumerable: false,
    });
    Object.defineProperty(axiosLike, 'response', {
      value: { status: 500, data: { code: -1, message: '上游模型异常' } },
      enumerable: false,
    });
    assertEqual(JSON.stringify(axiosLike), '{}', '复现旧实现的缺陷');

    const converted = toHttpError(axiosLike);
    assertTrue(converted instanceof HttpError, '应转成 HttpError');
    assertEqual(converted.status, 500, 'status 取自 err.response.status');
    assertEqual(converted.message, '上游模型异常（HTTP 500）', 'message 优先取响应体 message');
    assertEqual(
      converted.bodySummary,
      '{"code":-1,"message":"上游模型异常"}',
      '响应体摘要取自 err.response.data',
    );
  });

  it('响应体无 message 时回落 axios 自身 message', () => {
    const converted = toHttpError({ message: 'timeout of 30000ms exceeded', response: { status: 504 } });
    assertEqual(converted.status, 504, 'status');
    assertEqual(converted.message, 'timeout of 30000ms exceeded（HTTP 504）', '回落 axios message');
  });

  it('网络层错误（无 response）不抛错、status 为 undefined', () => {
    const converted = toHttpError(new Error('Network Error'), '无法连接 AI 服务');
    assertTrue(converted instanceof HttpError, '仍是 HttpError');
    assertTrue(converted.status === undefined, 'status 缺省');
    assertEqual(converted.message, 'Network Error', '保留原始 message');
  });

  it('字符串错误与空值走兜底文案', () => {
    assertEqual(toHttpError('boom').message, 'boom', '字符串错误保留文本');
    assertEqual(toHttpError(null, '网络请求失败').message, '网络请求失败', 'null 走 fallback');
    assertEqual(toHttpError(undefined).message, '网络请求失败', 'undefined 走默认 fallback');
  });

  it('已是 HttpError 时原样返回（不二次包装）', () => {
    const origin = new HttpError('消息不能为空', 400);
    assertTrue(toHttpError(origin) === origin, '应保持同一实例');
  });

  it('bodySummary 超长截断，序列化失败退化为 String()', () => {
    const long = 'a'.repeat(ERROR_BODY_SUMMARY_LIMIT + 50);
    const summary = summarizeErrorBody(long) as string;
    assertTrue(summary.endsWith('...(截断)'), '应以截断标记结尾');
    assertEqual(summary.length, ERROR_BODY_SUMMARY_LIMIT + '...(截断)'.length, '截断长度');
    assertTrue(summarizeErrorBody('x') === 'x', '短文本原样');
    assertTrue(summarizeErrorBody(null) === undefined, 'null 返回 undefined');
    assertTrue(summarizeErrorBody(undefined) === undefined, 'undefined 返回 undefined');

    const circular: any = { name: 'loop' };
    circular.self = circular;
    const fallbackSummary = summarizeErrorBody(circular) as string;
    assertTrue(typeof fallbackSummary === 'string' && fallbackSummary.length > 0, '循环引用不抛错');
  });

  it('AbortError 可被 isAbortError 识别（含 DOMException 形态）', () => {
    assertTrue(isAbortError(new AbortError()), 'AbortError 实例');
    assertTrue(isAbortError({ name: 'AbortError', message: 'aborted' }), 'DOMException 形态');
    assertFalse(isAbortError(new HttpError('x', 500)), 'HttpError 不是取消');
    assertFalse(isAbortError(null), 'null 不抛错');
    assertFalse(isAbortError(new Error('AbortError')), '仅 message 命中不算取消');
  });
});

describe('pickBodyMessage：兼容 HttpExceptionFilter 与 ValidationPipe', () => {
  it('取字符串 message / 数组首项 / 空值', () => {
    assertEqual(pickBodyMessage({ code: -1, message: '线程不存在' }), '线程不存在', 'filter 形态');
    assertEqual(pickBodyMessage({ message: ['message 太短', 'x'] }), 'message 太短', 'ValidationPipe 数组');
    assertEqual(pickBodyMessage('纯文本'), '纯文本', '字符串响应体');
    assertEqual(pickBodyMessage({}), '', '无 message');
    assertEqual(pickBodyMessage(null), '', 'null');
    assertEqual(pickBodyMessage({ message: 123 }), '', '非字符串 message 忽略');
    assertEqual(pickBodyMessage({ message: [] }), '', '空数组');
  });
});

describe('unwrapEnvelope：兼容 TransformInterceptor 包装与裸 JSON', () => {
  it('ai 路由 @SkipInterceptor 的裸 JSON 原样返回', () => {
    assertDeepEqual(unwrapEnvelope({ threadId: 't1' }), { threadId: 't1' }, '裸对象');
    assertDeepEqual(unwrapEnvelope({ status: 'pending' }), { status: 'pending' }, 'pending 裸对象');
  });

  it('{ code, data, message } 外壳剥出 data', () => {
    assertDeepEqual(
      unwrapEnvelope({ code: 0, data: { threadId: 't2' }, message: '请求成功' }),
      { threadId: 't2' },
      '应剥出 data',
    );
    assertDeepEqual(
      unwrapEnvelope({ code: -1, data: { status: 'error' }, message: 'x' }),
      { status: 'error' },
      '错误外壳同样剥出',
    );
  });

  it('形态不符时不强剥（缺 data / data 非对象 / 非对象）', () => {
    assertDeepEqual(unwrapEnvelope({ code: 0, message: 'x' }), { code: 0, message: 'x' }, '缺 data');
    assertDeepEqual(unwrapEnvelope({ code: 0, data: null }), { code: 0, data: null }, 'data 为 null');
    assertDeepEqual(unwrapEnvelope({ code: 0, data: 5 }), { code: 0, data: 5 }, 'data 非对象');
    assertTrue(unwrapEnvelope(null) === null, 'null → null');
    assertTrue(unwrapEnvelope('text') === null, '字符串 → null');
    assertTrue(unwrapEnvelope(undefined) === null, 'undefined → null');
  });
});

describe('normalizeResultPayload：result 端点四态', () => {
  it('202 pending（兼容 processing 别名）', () => {
    assertDeepEqual(normalizeResultPayload({ status: 'pending' }), { status: 'pending' }, 'pending');
    assertDeepEqual(normalizeResultPayload({ status: 'processing' }), { status: 'pending' }, 'processing → pending');
  });

  it('200 done：透传 AiResult', () => {
    const draft = { kind: 'generate', flowDraft: { nodes: [], edges: [] } };
    assertDeepEqual(
      normalizeResultPayload({ status: 'done', data: draft }),
      { status: 'done', data: draft },
      'generate 结果',
    );
    assertDeepEqual(
      normalizeResultPayload({ status: 'done', data: { kind: 'consult', answer: 'hi' } }),
      { status: 'done', data: { kind: 'consult', answer: 'hi' } },
      'consult 结果',
    );
    assertDeepEqual(
      normalizeResultPayload({ status: 'done' }),
      { status: 'done', data: {} },
      'data 缺失时降级为空对象，不抛错',
    );
  });

  it('200 need_confirm：字段降级为安全默认值', () => {
    const payload = {
      status: 'need_confirm',
      data: {
        reason: '存在语义冲突',
        issues: [{ layer: 'semantic', message: '缺少结束节点', nodeIds: ['n1'] }],
        candidates: [{ id: 'c1', label: '补充结束节点' }],
      },
    };
    assertDeepEqual(normalizeResultPayload(payload), payload, '完整 payload 原样归一化');
    assertDeepEqual(
      normalizeResultPayload({ status: 'need_confirm' }),
      { status: 'need_confirm', data: { reason: '', issues: [], candidates: [] } },
      'data 缺失时全字段降级',
    );
    assertDeepEqual(
      normalizeResultPayload({ status: 'need_confirm', data: { reason: 5, issues: 'x' } }),
      { status: 'need_confirm', data: { reason: '', issues: [], candidates: [] } },
      '脏字段被替换为默认值',
    );
  });

  it('200 error：取 message，缺省给兜底文案', () => {
    assertDeepEqual(
      normalizeResultPayload({ status: 'error', message: '上游超时' }),
      { status: 'error', message: '上游超时' },
      'error 消息',
    );
    assertDeepEqual(
      normalizeResultPayload({ status: 'error' }),
      { status: 'error', message: 'AI 执行失败' },
      'message 缺失走兜底',
    );
  });

  it('未知 status / 包装外壳 / 空响应体', () => {
    assertTrue(normalizeResultPayload({ status: 'weird' }) === null, '未知 status → null');
    assertTrue(normalizeResultPayload({}) === null, '空对象 → null');
    assertTrue(normalizeResultPayload(null) === null, 'null → null');
    assertDeepEqual(
      normalizeResultPayload({ code: 0, data: { status: 'pending' }, message: '请求成功' }),
      { status: 'pending' },
      '被包装时先剥壳再归一化',
    );
  });
});

describe('normalizeConfirmPayload：confirm 响应', () => {
  it('取 threadId，缺失时回落入参', () => {
    assertDeepEqual(
      normalizeConfirmPayload({ status: 'pending', threadId: 'th-9' }),
      { status: 'pending', threadId: 'th-9' },
      '裸响应',
    );
    assertDeepEqual(
      normalizeConfirmPayload({ status: 'pending' }, 'th-fallback'),
      { status: 'pending', threadId: 'th-fallback' },
      'threadId 缺失回落',
    );
    assertDeepEqual(
      normalizeConfirmPayload({ code: 0, data: { status: 'pending', threadId: 'th-w' }, message: 'ok' }),
      { status: 'pending', threadId: 'th-w' },
      '包装外壳',
    );
    assertTrue(normalizeConfirmPayload(null) === null, 'null → null');
    assertTrue(normalizeConfirmPayload('oops') === null, '字符串 → null');
  });
});

finish('aiClient');
