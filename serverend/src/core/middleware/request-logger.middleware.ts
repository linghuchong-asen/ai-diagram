import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { customLogger } from '../../utils/log/logger.service';

/**
 * 请求日志中间件
 * 记录每个 HTTP 请求的关键信息：方法、URL、IP、耗时、状态码
 */
@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const { method, originalUrl, ip } = req;

    // 存活探针免日志：docker healthcheck 每 15s 打一次 /health，
    // 计入日志会造成 ~1.2 万行/天的噪音（商业化首发新增）
    if (method === 'GET' && (originalUrl === '/health' || originalUrl === '/api/health')) {
      next();
      return;
    }

    const startTime = Date.now();

    // 打印请求开始日志
    customLogger.log(
      `→ 请求开始: [${method}] ${originalUrl} | IP: ${ip}`,
      'Request',
    );

    // 可选：仅在非生产环境下打印请求体（避免敏感数据泄漏到生产日志）
    if (
      process.env.NODE_ENV !== 'production' &&
      req.body &&
      Object.keys(req.body).length > 0
    ) {
      // 脱敏处理：如果有 password 字段则隐藏
      const safeBody = { ...req.body };
      if (safeBody.password) safeBody.password = '******';
      customLogger.debug(
        `  Body: ${JSON.stringify(safeBody)}`,
        'Request',
      );
    }

    if (req.query && Object.keys(req.query).length > 0) {
      customLogger.debug(
        `  Query: ${JSON.stringify(req.query)}`,
        'Request',
      );
    }

    // 监听响应完成事件
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const statusCode = res.statusCode;
      const level = statusCode >= 400 ? 'warn' : 'log';

      customLogger[level](
        `← 响应结束: [${method}] ${originalUrl} | 状态: ${statusCode} | 耗时: ${duration}ms`,
        'Request',
      );
    });

    next();
  }
}
