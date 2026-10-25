import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { TOKEN_STORE, InMemoryTokenStore } from './token.store';

// 商业化首发修复：原 spec 自 Task 11.1(JWT 重构)后缺少 JwtService/TOKEN_STORE 桩。
describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: JwtService, useValue: { sign: jest.fn(() => 'test-token') } },
        { provide: TOKEN_STORE, useValue: new InMemoryTokenStore() },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
