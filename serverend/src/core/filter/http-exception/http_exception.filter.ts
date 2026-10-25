/*
 * @Description: filter文件，对于捕获到的异常进行处理
 * @Author: yangsen
 * @Date: 2024-11-27 10:29:42
 * @LastEditors: yangsen
 * @LastEditTime: 2026-07-06 16:06:21
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { customLogger } from '../../../utils/log/logger.service';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  /*
   * exception: 捕获到的异常对象。
   * 由于 @Catch() 无参数，会捕获所有异常，处理方式如下：
   *   - HttpException（如 validator 校验抛出的 BadRequestException 等）：通过 getStatus() / getResponse() 提取状态码及响应体
   *   - 原生 Error（如 throw new Error()）：默认视为 500 服务端内部错误，直接取 message 作为错误信息
   * host: 当前请求的上下文对象，包含请求和响应的信息。
   */
  catch(exception: HttpException | Error, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();

    // 兼容普通 Error 和 HttpException
    const status = exception instanceof HttpException
      ? exception.getStatus()
      : 500;

    let exceptionResponse: any;
    if (exception instanceof HttpException) {
      exceptionResponse = exception.getResponse();
    }

    let validateMessage: string;
    if (exceptionResponse && typeof exceptionResponse === 'object') {
      validateMessage = exceptionResponse['message'];
    }

    // 业务异常若响应体自带 code(如 TRIAL_USED/TRIAL_BUSY/TRIAL_RATE_LIMITED/
    // TEMPLATE_RATE_LIMITED/AI_QUOTA_EXCEEDED 等字符串业务码),原样透传,
    // 供前端 aiClient.pickErrorCode 直连识别;仅在没有 code 时才用 -1 兜底
    // (保持既有数字 code 行为完全兼容,校验管道/原生 Error 等不受影响)。
    const businessCode =
      exceptionResponse &&
      typeof exceptionResponse === 'object' &&
      exceptionResponse['code'] !== undefined
        ? exceptionResponse['code']
        : -1;

    // 设置错误信息
    const message = exception.message
      ? exception.message
      : `${status >= 500 ? 'Server Error' : 'Client Error'}`;
    const errorResponse = {
      code: businessCode,
      data: {},
      message: validateMessage || message,
      request: `${ctx.getRequest().method} ${ctx.getRequest().url}`,
    };

    // ========== 记录更详细的错误日志 ==========
    customLogger.error(
      `异常: [${request.method}] ${request.url} | 状态: ${status} | IP: ${request.ip} | 消息: ${validateMessage || message}`,
      exception.stack,
      'HttpExceptionFilter',
    );

    // 设置返回的状态码， 请求头，发送错误信息
    response.status(status);
    response.header('Content-Type', 'application/json; charset=utf-8');
    response.send(errorResponse);
  }
}
