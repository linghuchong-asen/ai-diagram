import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { UserService } from './user.service';
import { UserEntity } from './entities/user.entity';
import { GrowthEventService } from '../observability/growth-event.service';
import { BillingService } from '../billing/billing.service';

// 商业化首发修复：原 spec 缺少 UserEntity 仓库桩，一直静默失败。
describe('UserService', () => {
  let service: UserService;
  let growthTrack: jest.Mock;
  let inviteRewards: jest.Mock;
  let userRepo: { findOne: jest.Mock; create: jest.Mock; save: jest.Mock; update: jest.Mock };

  beforeEach(async () => {
    growthTrack = jest.fn();
    inviteRewards = jest.fn(async () => ({ inviterRewarded: false, welcomeGranted: false }));
    userRepo = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      update: jest.fn(),
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
        // 邀请裂变批次:奖励桩（BillingService 经 UserModule→BillingModule 注入）
        {
          provide: BillingService,
          useValue: { applyInviteRewards: inviteRewards },
        },
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

  it('快赢批次一:携带 channel → register 事件带渠道归因（截断 ≤64、去控制字符）', async () => {
    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockImplementation((x) => x);
    userRepo.save.mockResolvedValue({ id: 'u-3', username: 'stu' });

    await service.register({
      username: 'stu',
      password: 'x',
      channel: '  xiaohongshu\t\n ',
    } as never);

    expect(growthTrack).toHaveBeenCalledWith('register', {
      userId: 'u-3',
      username: 'stu',
      channel: 'xiaohongshu',
    });

    growthTrack.mockClear();
    userRepo.findOne.mockResolvedValue(null);
    await service.register({
      username: 'stu2',
      password: 'x',
      channel: `c-${'a'.repeat(100)}`,
    } as never);
    expect(growthTrack).toHaveBeenCalledWith('register', {
      userId: 'u-3',
      username: 'stu2',
      channel: `c-${'a'.repeat(62)}`, // 64 字符截断
    });
  });

  it('快赢批次一:未携带 channel → 事件不含渠道字段（不写入 undefined 键）', async () => {
    userRepo.findOne.mockResolvedValue(null);
    userRepo.create.mockImplementation((x) => x);
    userRepo.save.mockResolvedValue({ id: 'u-4', username: 'plain' });

    await service.register({ username: 'plain', password: 'x' } as never);

    expect(growthTrack).toHaveBeenCalledWith('register', {
      userId: 'u-4',
      username: 'plain',
      channel: undefined,
    });
  });

  describe('邀请裂变（invite-referral-batch）', () => {
    it('合法邀请码 → 落 invitedBy 归因 + 触发双向奖励', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null) // 用户名查重
        .mockResolvedValueOnce({ id: 'inviter-1', inviteCode: 'ABCD2345' }); // 邀请人
      userRepo.create.mockImplementation((x) => x);
      userRepo.save.mockResolvedValue({ id: 'u-new' });

      await service.register({ username: 'n1', password: 'x', inviteCode: 'ABCD2345' } as never);

      expect(userRepo.update).toHaveBeenCalledWith('u-new', { invitedBy: 'ABCD2345' });
      expect(inviteRewards).toHaveBeenCalledWith('u-new', 'ABCD2345');
    });

    it('非法/不存在的邀请码 → 不归因不奖励，注册照常成功', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockImplementation((x) => x);
      userRepo.save.mockResolvedValue({ id: 'u-new' });

      // 非白名单字符直接被 sanitize 过滤（连邀请人查询都不会发生）；不存在的码查询后跳过
      await service.register({ username: 'n2', password: 'x', inviteCode: 'BAD!!码' } as never);
      await service.register({ username: 'n3', password: 'x', inviteCode: 'ZZZZ9999' } as never);

      expect(userRepo.update).not.toHaveBeenCalled();
      expect(inviteRewards).not.toHaveBeenCalled();
    });

    it('归因/奖励链路抛错 → 注册仍成功（旁路语义）', async () => {
      userRepo.findOne
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'inviter-1', inviteCode: 'ABCD2345' });
      userRepo.create.mockImplementation((x) => x);
      userRepo.save.mockResolvedValue({ id: 'u-new' });
      userRepo.update.mockRejectedValue(new Error('db down'));

      const saved = await service.register({ username: 'n4', password: 'x', inviteCode: 'ABCD2345' } as never);
      expect(saved).toMatchObject({ id: 'u-new' });
      expect(growthTrack).toHaveBeenCalledTimes(1);
    });
  });

  describe('分享归因（share-attribution-batch）', () => {
    it('合法分享 token（32 位 hex）→ register 事件携带 shareToken', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockImplementation((x) => x);
      userRepo.save.mockResolvedValue({ id: 'u-6', username: 's1' });

      await service.register({
        username: 's1',
        password: 'x',
        shareToken: 'a'.repeat(32),
      } as never);

      expect(growthTrack).toHaveBeenCalledWith(
        'register',
        expect.objectContaining({ userId: 'u-6', shareToken: 'a'.repeat(32) }),
      );
    });

    it('非法分享 token → 事件不带 shareToken（不写 undefined 键）', async () => {
      userRepo.findOne.mockResolvedValue(null);
      userRepo.create.mockImplementation((x) => x);
      userRepo.save.mockResolvedValue({ id: 'u-7', username: 's2' });

      await service.register({
        username: 's2',
        password: 'x',
        shareToken: 'NOT-VALID-TOKEN',
      } as never);

      const payload = (growthTrack as jest.Mock).mock.calls[0][1];
      expect(payload.shareToken).toBeUndefined();
    });
  });
});
