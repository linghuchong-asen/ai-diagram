import {
  Controller,
  Post,
  Body,
  UseGuards,
  UseInterceptors,
  ClassSerializerInterceptor,
  Req,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { AuthGuard } from '@nestjs/passport';
import { JwtAuthGuard } from './auth.guard';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { InjectRepository } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/entities/user.entity';
import { Repository } from 'typeorm';

@Controller('auth')
export class AuthController {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly authService: AuthService,
  ) {}

  @Post('login')
  // 商业化首发加固：限流守卫先于认证执行（未认证的请求也要计数，否则爆破方绕过计数）
  @UseGuards(AuthRateLimitGuard, AuthGuard('local')) //UseGuards装饰器可以传入多个认证守卫，在接收到对应请求时，会依次调用认证守卫
  @UseInterceptors(ClassSerializerInterceptor)
  async login(@Body() loginInfo: LoginDto, @Req() req) {
    // 逻辑能走到这里，证明用户登录认证已经通过;验证用户名密码的逻辑是在passport这个库的local策略中执行的
    const existUser = await this.userRepository.findOne({
      where: { username: loginInfo.username },
    });
    if (!existUser) {
      throw new HttpException('用户不存在', HttpStatus.BAD_REQUEST);
    }
    const token = await this.authService.getToken({
      id: existUser.id,
      ...loginInfo,
    });
    return `Bearer ${token}`;
  }

  /**
   * 登出(Task 11.3):服务端吊销当前令牌(令牌态存储 auth_tokens 表,只存 sha256 摘要)。
   * 前端同时删除本地 token;此后该 JWT 即使未过期也会被 JwtStrategy 拒绝。
   */
  @Post('logout')
  @UseGuards(JwtAuthGuard)
  async logout(@Req() req) {
    const header: string = req?.headers?.authorization ?? '';
    const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : '';
    await this.authService.logout(token);
    return { message: '登出成功' };
  }

  // 通过前端删除token + 服务端吊销令牌态的方式退出登录
}
