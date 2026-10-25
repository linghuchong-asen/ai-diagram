import { Module } from '@nestjs/common';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { LocalStrategy } from './local.strategy';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from 'src/user/entities/user.entity';
import { PassportModule } from '@nestjs/passport';
import { JwtModule } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { UserService } from 'src/user/user.service';
import { AuthTokenEntity } from './entities/auth-token.entity';
import {
  getRepositoryToken,
} from '@nestjs/typeorm';
import {
  InMemoryTokenStore,
  PgTokenStore,
  TOKEN_STORE,
  TokenStore,
} from './token.store';
import { requireJwtSecret } from './jwt-secret';

const jwtModule = JwtModule.registerAsync({
  inject: [ConfigService],
  useFactory: async (configService: ConfigService) => {
    return {
      // Task 11.4:JWT secret 强制环境变量,缺失/历史默认值直接启动报错(见 jwt-secret.ts)
      secret: requireJwtSecret(configService),
      signOptions: { expiresIn: '24h' },
    };
  },
});

@Module({
  // 用于导入其他模块，而且是导入了jwtModule模块才可以在当前模块的JwtStrategy中使用jwtService
  imports: [
    TypeOrmModule.forFeature([UserEntity, AuthTokenEntity]),
    PassportModule,
    jwtModule,
  ],
  controllers: [AuthController],
  // 服务提供者，不是模块这个级别，是具体的服务
  providers: [
    AuthService,
    LocalStrategy,
    JwtStrategy,
    UserService,
    /* Task 11.3:令牌态存储,默认 PG(auth_tokens 表);TOKEN_STORE=memory 时用内存实现(单测/本地) */
    {
      provide: TOKEN_STORE,
      useFactory: (config: ConfigService, tokenRepo): TokenStore =>
        (config.get('TOKEN_STORE') || 'pg').toLowerCase() === 'memory'
          ? new InMemoryTokenStore()
          : new PgTokenStore(tokenRepo),
      inject: [ConfigService, getRepositoryToken(AuthTokenEntity)],
    },
  ],
  /* 如果其他模块中需要使用依赖注入的方式 */
  exports: [jwtModule],
})
export class AuthModule {}
