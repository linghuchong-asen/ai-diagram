// HttpExceptionFilter 单测:业务 code 透传契约(增长与变现收尾修复)
// 覆盖:对象带字符串业务 code 原样透传、无 code 时 -1 兜底、原生 Error 500 兜底
import { ArgumentsHost, BadRequestException, HttpException, HttpStatus } from '@nestjs/common';
import { HttpExceptionFilter } from './http_exception.filter';
import { customLogger } from '../../../utils/log/logger.service';

function makeHost() {
  const send = jest.fn();
  const status = jest.fn();
  const header = jest.fn();
  const response = { send, status, header };
  const request = { method: 'POST', url: '/ai/trial/chat', ip: '1.2.3.4' };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;
  return { host, send, status, header };
}

describe('HttpExceptionFilter', () => {
  let filter: HttpExceptionFilter;

  beforeEach(() => {
    filter = new HttpExceptionFilter();
    // 屏蔽单测期间的错误日志输出与日志文件写入
    jest.spyOn(customLogger, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(filter).toBeDefined();
  });

  it('对象带字符串业务 code(如 429 TRIAL_USED)→ 原样透传 code 与 message', () => {
    const { host, send } = makeHost();
    const exception = new HttpException(
      { code: 'TRIAL_USED', message: '试用次数已用完，注册后每日可生成 3 次' },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'TRIAL_USED',
        message: '试用次数已用完，注册后每日可生成 3 次',
        request: 'POST /ai/trial/chat',
      }),
    );
  });

  it('对象带字符串业务 code 且为其他业务码(AI_QUOTA_EXCEEDED)→ 同样透传', () => {
    const { host, send } = makeHost();
    const exception = new HttpException(
      {
        code: 'AI_QUOTA_EXCEEDED',
        message: '今日 AI 配额已用完(生成):已用 3/3',
        scope: '生成',
        limit: 3,
        used: 3,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );

    filter.catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 'AI_QUOTA_EXCEEDED',
        message: '今日 AI 配额已用完(生成):已用 3/3',
      }),
    );
  });

  it('对象无 code(标准 BadRequestException 校验形态)→ code 兜底 -1,message 透传', () => {
    const { host, send, status } = makeHost();
    const exception = new BadRequestException(['字段校验失败']);

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        message: ['字段校验失败'],
      }),
    );
  });

  it('字符串响应体的 HttpException → code 兜底 -1 且 message 透传(既有行为兼容)', () => {
    const { host, send } = makeHost();
    const exception = new HttpException('纯文本错误', HttpStatus.BAD_REQUEST);

    filter.catch(exception, host);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        message: '纯文本错误',
      }),
    );
  });

  it('原生 Error → 500 且 code 兜底 -1', () => {
    const { host, send, status } = makeHost();
    const exception = new Error('数据库连接失败');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(500);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        code: -1,
        message: '数据库连接失败',
      }),
    );
  });
});
