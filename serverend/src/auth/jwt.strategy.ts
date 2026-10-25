/*
 * @Description: 验证jwt
 * @Author: yangsen
 * @Date: 2024-11-27 10:29:42
 * @LastEditors: yangsen
 * @LastEditTime: 2025-08-17 11:04:34
 */
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { RoleEnum } from 'src/user/entities/user.entity';
import { AuthService } from './auth.service';
import { ExtractJwt, Strategy, StrategyOptions } from 'passport-jwt';
import {
  ClassSerializerInterceptor,
  Injectable,
  UnauthorizedException,
  UseInterceptors,
} from '@nestjs/common';
import { UserService } from 'src/user/user.service';
import { requireJwtSecret } from './jwt-secret';

interface jwtPayload {
  id: string;
  username: string;
  role: RoleEnum;
}

// NOTE:！！！确认Strategy来自passport-jwt
// NOTE:@Injectable() 必须保留：tsc 仅对带装饰器的类发射 design:paramtypes 元数据，
//       缺失会导致 DI 无法识别构造参数类型，全部注入 undefined，启动时崩溃。
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    // NOTE:ConfigService 以普通参数传入(非参数属性):super() 之前不允许引用 this
    ConfigService: ConfigService,
    private readonly authService: AuthService,
    private readonly userService: UserService,
  ) {
    super({
      // 从请求头的Authorization: Bearer <token>中提取token
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // 使用密钥验证签名(Task 11.4:强制环境变量,不再代码内兜底)
      secretOrKey: requireJwtSecret(ConfigService),
      // Task 11.3:需要原始请求以取出 Bearer token 做吊销校验
      passReqToCallback: true,
    } as StrategyOptions & { passReqToCallback: true });
    /*  console.log('验证用jwt', ConfigService.get('JWT_SECRET')); */
  }

  /* NOTE: payload是已经通过passport-jwt解析过了的负载。
   * passReqToCallback=true 时,@nestjs/passport 直传 verify 参数:validate(req, payload, done),
   * 第一个参数是原始请求(用于取出 Bearer token 做吊销校验),payload 是第二个。 */
  @UseInterceptors(ClassSerializerInterceptor)
  async validate(req: any, payload: jwtPayload) {
    const userId = payload.id;

    // Task 11.3:登出/主动失效校验 —— 令牌在 auth_tokens 表中已被吊销则拒绝
    const bearerToken: string | null = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
    if (bearerToken && (await this.authService.isTokenRevoked(bearerToken))) {
      throw new UnauthorizedException('登录状态已失效，请重新登录');
    }

    const existUser = await this.userService.getUserById(userId);
    if (!existUser) {
      throw new UnauthorizedException('token不正确');
    }

    // const isBlacklisted = await this.redisCacheService.isUserInBlacklist(
    //   userId,
    // );
    // if (isBlacklisted) {
    //   throw new UnauthorizedException('黑名单用户');
    // }

    // NOTE: validate返回值会被添加到请求对象的req.user属性上，这样你可以在后续的处理器（如控制器方法）中访问到这个用户信息。
    return existUser;
  }
}
