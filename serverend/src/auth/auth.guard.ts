/*
 * @Description: 身份认证守卫，会调用jwt.strategy.ts策略，可以将用户信息写入到request对象中
 * @Author: yangsen
 * @Date: 2024-11-13 16:28:10
 * @LastEditors: yangsen
 * @LastEditTime: 2025-06-10 15:07:44
 */
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from './public.decorator';

// NOTE:@Injectable() 必须保留：tsc 仅对带装饰器的类发射 design:paramtypes 元数据，
//       缺失会导致 DI 无法识别 Reflector 构造参数，注入 undefined，
//       canActivate 里 this.reflector.getAllAndOverride 抛 TypeError → 所有鉴权路由 500。
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /* Task 11.1:支持 @Public() 装饰器豁免鉴权(SSE 端点浏览器无法携带 Authorization 头) */
  constructor(private readonly reflector: Reflector) {
    super();
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  getRequest(context: ExecutionContext) {
    const ctx = context.switchToHttp();
    const request = ctx.getRequest();
    return request;
  }

  /* JwtStrategy中的validate 方法：负责解析和验证 JWT 令牌，返回用户信息。
  handleRequest 方法：负责处理 validate 方法的返回结果，将用户信息添加到请求对象 req 上，并处理验证失败的情况。 */
  handleRequest<TUser = any>(
    err: any,
    user: any,
    info: any,
    context: ExecutionContext,
    status?: any,
  ): TUser {
    if (err || !user) {
      throw new UnauthorizedException('身份认证失败');
    }
    return user;
  }
}
