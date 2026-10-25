import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TOKEN_STORE, InMemoryTokenStore } from './token.store';
import { UserEntity } from 'src/user/entities/user.entity';

// 商业化首发修复：原脚手架 spec 自 Task 11.1(JWT 重构)后缺少依赖声明，
// 一直因 moduleNameMapper 缺失而静默失败；补齐 JwtService/TOKEN_STORE/User 仓库桩。
describe('AuthController', () => {
  let controller: AuthController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign: jest.fn(() => 'test-token') } },
        { provide: TOKEN_STORE, useValue: new InMemoryTokenStore() },
        {
          provide: getRepositoryToken(UserEntity),
          useValue: { findOne: jest.fn() },
        },
      ],
    }).compile();

    controller = module.get<AuthController>(AuthController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
