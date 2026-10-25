import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserEntity } from './entities/user.entity';
import { GrowthEventService } from '../observability/growth-event.service';

// 商业化首发修复：原 spec 缺少 UserEntity 仓库桩，一直静默失败。
describe('UserService', () => {
  let service: UserService;
  let growthTrack: jest.Mock;
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock };

  beforeEach(async () => {
    growthTrack = jest.fn();
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UserService,
        {
          provide: getRepositoryToken(UserEntity),
          useValue: userRepo,
        },
        // Task 4 埋点桩:GrowthEventService 为 @Global ObservabilityModule 导出,单测中给桩即可
        { provide: GrowthEventService, useValue: { track: growthTrack } },
      ],
    }).compile();

    service = module.get<UserService>(UserService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('注册成功 → track("register", { userId, username }) 恰一次（Task 4 埋点）', async () => {
    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockImplementation((x) => x);
    userRepo.save.mockResolvedValue({ id: 'u-1', username: 'sen' });

    await service.register({ username: 'sen', password: 'x' } as never);

    expect(growthTrack).toHaveBeenCalledTimes(1);
    expect(growthTrack).toHaveBeenCalledWith('register', {
      userId: 'u-1',
      username: 'sen',
    });
  });

  it('用户名已存在 → 400,不记埋点', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u-2', username: 'sen' });

    await expect(
      service.register({ username: 'sen', password: 'x' } as never),
    ).rejects.toMatchObject({ status: 400 });
    expect(growthTrack).not.toHaveBeenCalled();
  });
});
