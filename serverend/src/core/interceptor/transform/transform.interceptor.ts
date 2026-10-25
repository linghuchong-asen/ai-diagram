/*
 * @Description:
 * @Author: yangsen
 * @Date: 2025-08-10 11:35:05
 * @LastEditors: yangsen
 * @LastEditTime: 2026-07-06 15:50:06
 */
/*
 * @Description: 拦截器可以访问到控制器的返回值，这里对响应数据进行处理，统一返回格式
 * @Author: yangsen
 * @Date: 2024-12-10 09:31:18
 * @LastEditors: yangsen
 * @LastEditTime: 2025-06-10 09:44:24
 */
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { customLogger } from '../../../utils/log/logger.service';

const logger = new Logger('拦截器');

@Injectable()
export class TransformInterceptor implements NestInterceptor {
  constructor(private reflector: Reflector) {}
  /* context：当前执行上下文
  next:并不是处理当前请求的处理器，而是指在当前拦截器之后的下一个处理器。这可以理解为请求处理链中的下一个环节。 */
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const request = context.switchToHttp().getRequest();

    // 判断是否需要跳过全局拦截器; context.getHandler()返回的是当前的路由
    const isSkip = this.reflector.get('skipInterceptor', context.getHandler());
    logger.debug('是否跳过全局拦截器', isSkip);
    if (isSkip) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => {
        const { method, url } = request;

        // ========== 仅非生产环境记录响应数据 ==========
        if (process.env.NODE_ENV !== 'production') {
          let logData: string;
          if (typeof data === 'string') {
            logData = data.length > 500 ? data.substring(0, 500) + '...(截断)' : data;
          } else if (Buffer.isBuffer(data)) {
            logData = `[Binary Buffer: ${data.length} bytes]`;
          } else {
            const jsonStr = JSON.stringify(data);
            logData = jsonStr.length > 1000 ? jsonStr.substring(0, 1000) + '...(截断)' : jsonStr;
          }

          customLogger.log(
            `响应数据: [${method}] ${url} | Data: ${logData}`,
            'TransformInterceptor',
          );
        }

        return {
          code: 0,
          data,
          message: '请求成功',
        };
      }),
    );
  }
}
